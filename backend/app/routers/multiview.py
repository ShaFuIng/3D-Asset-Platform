import asyncio
from pathlib import Path

from fastapi import APIRouter, Request, Response, status
from fastapi.responses import FileResponse

from ..errors import ApiError
from ..schemas import (
    CreateMultiviewJobRequest,
    CreateMultiviewJobResponse,
    JobStatus,
    MultiviewImageRef,
    MultiviewJobResponse,
    MultiviewModelJobResponse,
    MultiviewModelRef,
    MultiviewSlotResponse,
    MultiviewViewVersionResponse,
    RegenerateMultiviewViewRequest,
    RegenerateStrategy,
    SetMultiviewCandidateRequest,
)
from ..services.multiview_jobs import (
    MultiviewJob,
    run_multiview_image_job,
    run_multiview_image_job_openai,
    run_multiview_model_job,
    run_multiview_view_openai_edit_job,
    run_multiview_view_regeneration_job,
    run_multiview_view_regeneration_job_openai,
)
from ..services.multiview_workflows import VIEW_ORDER

router = APIRouter()


@router.post(
    "/api/multiview/jobs",
    response_model=CreateMultiviewJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_multiview_job(
    request: Request, payload: CreateMultiviewJobRequest
) -> CreateMultiviewJobResponse:
    reference = request.app.state.storage.get_image_by_id(payload.reference_image_id)
    if payload.provider == "local":
        await request.app.state.comfy_client.ensure_available()
        request.app.state.qwen_multiview_workflow.prepare_three_view_workflow("preflight.png")
    job = await request.app.state.multiview_job_store.create(reference, payload.provider)
    if not getattr(request.app.state, "disable_background_jobs", False):
        usage_lease = request.app.state.asset_usage_guard.acquire(
            reference.image_id,
            owner=f"multiview-image-job:{job.job_id}",
            reason="multiview_reference_image",
        )
        try:
            if payload.provider == "local":
                task = asyncio.create_task(
                    run_multiview_image_job(
                        job.job_id,
                        reference,
                        request.app.state.multiview_job_store,
                        request.app.state.comfy_client,
                        request.app.state.qwen_multiview_workflow,
                        request.app.state.storage,
                        usage_lease,
                    )
                )
            else:
                task = asyncio.create_task(
                    run_multiview_image_job_openai(
                        job.job_id,
                        reference,
                        request.app.state.multiview_job_store,
                        request.app.state.openai_client,
                        request.app.state.storage,
                        usage_lease,
                    )
                )
            request.app.state.background_tasks.add(task)
            task.add_done_callback(request.app.state.background_tasks.discard)
        except Exception:
            usage_lease.release()
            raise
    return CreateMultiviewJobResponse(
        job_id=job.job_id,
        status=job.status,
        provider=job.provider,
        status_url=f"/api/multiview/jobs/{job.job_id}",
    )


@router.get("/api/multiview/jobs/{job_id}", response_model=MultiviewJobResponse)
async def get_multiview_job(request: Request, job_id: str) -> MultiviewJobResponse:
    job = await _get_job(request, job_id)
    return _job_response(request, job)


@router.post(
    "/api/multiview/jobs/{job_id}/views/{view}/accept",
    response_model=MultiviewJobResponse,
)
async def accept_multiview_view(request: Request, job_id: str, view: str) -> MultiviewJobResponse:
    if view not in VIEW_ORDER:
        raise ApiError(400, "invalid_view", "View must be front, left, or back.")
    job = await request.app.state.multiview_job_store.accept_view(job_id, view)
    return _job_response(request, job)


@router.post(
    "/api/multiview/jobs/{job_id}/views/{view}/candidate",
    response_model=MultiviewJobResponse,
)
async def set_multiview_view_candidate(
    request: Request,
    job_id: str,
    view: str,
    payload: SetMultiviewCandidateRequest,
) -> MultiviewJobResponse:
    if view not in VIEW_ORDER:
        raise ApiError(400, "invalid_view", "View must be front, left, or back.")
    job = await _get_job(request, job_id)
    slot = job.views[view]
    if not any(version.image.image_id == payload.image_id for version in slot.versions):
        raise ApiError(400, "version_not_found", "Image is not a version of this view.")
    _validate_candidate_asset(request, payload.image_id, job_id, view)
    updated = await request.app.state.multiview_job_store.set_view_candidate_from_version(
        job_id,
        view,
        payload.image_id,
    )
    return _job_response(request, updated)


@router.post(
    "/api/multiview/jobs/{job_id}/views/{view}/regenerate",
    response_model=MultiviewJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def regenerate_multiview_view(
    request: Request,
    job_id: str,
    view: str,
    payload: RegenerateMultiviewViewRequest,
) -> MultiviewJobResponse:
    if view not in VIEW_ORDER:
        raise ApiError(400, "invalid_view", "View must be front, left, or back.")
    job = await _get_job(request, job_id)
    slot = job.views[view]
    if slot.current_image is None:
        raise ApiError(409, "view_not_ready", "View image is not ready.")
    if payload.strategy == RegenerateStrategy.local_reroll:
        await request.app.state.comfy_client.ensure_available()
        request.app.state.qwen_multiview_workflow.prepare_single_view_workflow("preflight.png", view)
        source = request.app.state.storage.get_image_by_id(job.reference_image.image_id)
        usage_reason = "multiview_regenerate_reference_image"
    elif payload.strategy == RegenerateStrategy.openai_reroll:
        # Blind regenerate from the reference image, mirroring local_reroll's
        # source choice rather than openai_edit's (which builds on the
        # current view image plus a user instruction).
        source = request.app.state.storage.get_image_by_id(job.reference_image.image_id)
        usage_reason = "multiview_regenerate_reference_image"
    else:
        source = request.app.state.storage.get_image_by_id(slot.current_image.image_id)
        usage_reason = "multiview_regenerate_current_image"
    attempt_id = _new_attempt_id()
    job = await request.app.state.multiview_job_store.start_view_regeneration(
        job_id,
        view,
        attempt_id,
        payload.strategy.value,
    )
    if not getattr(request.app.state, "disable_background_jobs", False):
        usage_lease = request.app.state.asset_usage_guard.acquire(
            source.image_id,
            owner=f"multiview-regenerate:{job_id}:{view}:{attempt_id}",
            reason=usage_reason,
        )
        try:
            if payload.strategy == RegenerateStrategy.local_reroll:
                task = asyncio.create_task(
                    run_multiview_view_regeneration_job(
                        job_id,
                        view,
                        attempt_id,
                        source,
                        request.app.state.multiview_job_store,
                        request.app.state.comfy_client,
                        request.app.state.qwen_multiview_workflow,
                        request.app.state.storage,
                        usage_lease,
                    )
                )
            elif payload.strategy == RegenerateStrategy.openai_reroll:
                task = asyncio.create_task(
                    run_multiview_view_regeneration_job_openai(
                        job_id,
                        view,
                        attempt_id,
                        source,
                        request.app.state.multiview_job_store,
                        request.app.state.openai_client,
                        request.app.state.storage,
                        usage_lease,
                    )
                )
            else:
                task = asyncio.create_task(
                    run_multiview_view_openai_edit_job(
                        job_id,
                        view,
                        attempt_id,
                        source,
                        job.reference_image.image_id,
                        payload.instruction or "",
                        request.app.state.multiview_job_store,
                        request.app.state.openai_client,
                        request.app.state.storage,
                        usage_lease,
                    )
                )
            request.app.state.background_tasks.add(task)
            task.add_done_callback(request.app.state.background_tasks.discard)
        except Exception:
            usage_lease.release()
            raise
    return _job_response(request, job)


@router.post(
    "/api/multiview/jobs/{job_id}/model-job",
    response_model=MultiviewModelJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_multiview_model_job(request: Request, job_id: str) -> MultiviewModelJobResponse:
    await request.app.state.comfy_client.ensure_available()
    request.app.state.hunyuan_multiview_workflow.prepare_workflow(
        front="front.png",
        left="left.png",
        back="back.png",
    )
    job = await request.app.state.multiview_job_store.start_model_job(job_id)
    if not getattr(request.app.state, "disable_background_jobs", False):
        asset_ids = [job.reference_image.image_id]
        for view in VIEW_ORDER:
            image = job.views[view].current_image
            if image is not None:
                asset_ids.append(image.image_id)
        usage_lease = request.app.state.asset_usage_guard.acquire_many(
            asset_ids,
            owner=f"multiview-model-job:{job.job_id}",
            reason="multiview_model_inputs",
        )
        try:
            task = asyncio.create_task(
                run_multiview_model_job(
                    job.job_id,
                    request.app.state.multiview_job_store,
                    request.app.state.comfy_client,
                    request.app.state.hunyuan_multiview_workflow,
                    request.app.state.storage,
                    usage_lease,
                )
            )
            request.app.state.background_tasks.add(task)
            task.add_done_callback(request.app.state.background_tasks.discard)
        except Exception:
            usage_lease.release()
            raise
    return _model_job_response(job)


@router.get("/api/multiview/jobs/{job_id}/model-job", response_model=MultiviewModelJobResponse)
async def get_multiview_model_job(request: Request, job_id: str) -> MultiviewModelJobResponse:
    job = await _get_job(request, job_id)
    return _model_job_response(job)


@router.get("/api/multiview/jobs/{job_id}/models/{kind}")
async def get_multiview_model(request: Request, job_id: str, kind: str) -> Response:
    if kind not in {"geometry", "textured"}:
        raise ApiError(400, "invalid_model_kind", "Model kind must be geometry or textured.")
    job = await _get_job(request, job_id)
    if job.model_job is None:
        raise ApiError(404, "model_job_not_found", "Multiview model job was not found.")
    if job.model_job.status in {JobStatus.queued, JobStatus.running}:
        raise ApiError(409, "job_not_complete", "Multiview 3D generation job is not complete.")
    if job.model_job.status == JobStatus.failed:
        raise ApiError(409, "job_failed", "Multiview 3D generation job failed.")
    path = job.model_job.geometry_path if kind == "geometry" else job.model_job.textured_path
    if path is None:
        raise ApiError(404, "model_not_found", "Generated GLB model was not found.")
    safe_path = _safe_model_path(request.app.state.storage.models_dir, path)
    return FileResponse(
        safe_path,
        media_type="model/gltf-binary",
        filename=f"{job_id}-{kind}.glb",
    )


@router.get("/api/multiview/jobs/{job_id}/models/{kind}/usdz")
async def get_multiview_model_usdz(request: Request, job_id: str, kind: str) -> Response:
    if kind not in {"geometry", "textured"}:
        raise ApiError(400, "invalid_model_kind", "Model kind must be geometry or textured.")
    job = await _get_job(request, job_id)
    if job.model_job is None:
        raise ApiError(404, "model_job_not_found", "Multiview model job was not found.")
    if job.model_job.status in {JobStatus.queued, JobStatus.running}:
        raise ApiError(409, "job_not_complete", "Multiview 3D generation job is not complete.")
    if job.model_job.status == JobStatus.failed:
        raise ApiError(409, "job_failed", "Multiview 3D generation job failed.")
    path = job.model_job.geometry_path if kind == "geometry" else job.model_job.textured_path
    if path is None:
        raise ApiError(404, "model_not_found", "Generated GLB model was not found.")
    safe_path = _safe_model_path(request.app.state.storage.models_dir, path)

    # Same graceful-degradation spirit as the geometry/textured `available`
    # split in _model_job_response: a failed conversion is a distinct
    # ApiError, not a raw 500, and never touches the model job's own status
    # or the GLB endpoint/Android Scene Viewer path. convert_or_raise()
    # also handles the on-disk cache check.
    usdz_path = safe_path.with_suffix(".usdz")
    await request.app.state.blender_client.convert_or_raise(safe_path, usdz_path)

    return FileResponse(
        usdz_path,
        media_type="model/vnd.usdz+zip",
        filename=f"{job_id}-{kind}.usdz",
    )


async def _get_job(request: Request, job_id: str) -> MultiviewJob:
    job = await request.app.state.multiview_job_store.get(job_id)
    if job is None:
        raise ApiError(404, "multiview_job_not_found", "Multiview job was not found.")
    return job


def _job_response(request: Request, job: MultiviewJob) -> MultiviewJobResponse:
    return MultiviewJobResponse(
        job_id=job.job_id,
        status=job.status,
        message=job.message,
        provider=job.provider,
        prompt_id=job.prompt_id,
        reference_image=_image_response(job.reference_image),
        views={
            view: MultiviewSlotResponse(
                status=slot.status,
                current_image=_image_response(slot.current_image) if slot.current_image else None,
                candidate_image=_image_response(slot.candidate_image) if slot.candidate_image else None,
                accepted=slot.accepted,
                error=slot.error,
                provider=slot.provider,
                versions=[
                    _version_response(request, version, slot)
                    for version in slot.versions
                ],
            )
            for view, slot in job.views.items()
        },
    )


def _model_job_response(job: MultiviewJob) -> MultiviewModelJobResponse:
    model_job = job.model_job
    if model_job is None:
        return MultiviewModelJobResponse(
            status=JobStatus.queued,
            message="Multiview 3D generation job has not been started.",
            prompt_id=None,
            geometry_model=MultiviewModelRef(available=False, download_url=None),
            textured_model=MultiviewModelRef(available=False, download_url=None),
        )
    return MultiviewModelJobResponse(
        status=model_job.status,
        message=model_job.message,
        prompt_id=model_job.prompt_id,
        geometry_model=MultiviewModelRef(
            available=model_job.geometry_path is not None and model_job.geometry_path.exists(),
            download_url=f"/api/multiview/jobs/{job.job_id}/models/geometry"
            if model_job.geometry_path is not None
            else None,
        ),
        textured_model=MultiviewModelRef(
            available=model_job.textured_path is not None and model_job.textured_path.exists(),
            download_url=f"/api/multiview/jobs/{job.job_id}/models/textured"
            if model_job.textured_path is not None
            else None,
        ),
    )


def _image_response(image) -> MultiviewImageRef:
    return MultiviewImageRef(
        image_id=image.image_id,
        filename=image.filename,
        url=f"/api/assets/images/{image.filename}",
    )


def _version_response(request: Request, version, slot) -> MultiviewViewVersionResponse:
    state = _asset_state(request, version.image.image_id)
    return MultiviewViewVersionResponse(
        image=_image_response(version.image),
        strategy=version.strategy,
        created_at=version.created_at,
        is_current=bool(slot.current_image and slot.current_image.image_id == version.image.image_id),
        is_candidate=bool(slot.candidate_image and slot.candidate_image.image_id == version.image.image_id),
        available=state == "active",
        state=state,
    )


def _asset_state(request: Request, image_id: str) -> str:
    catalog = request.app.state.asset_catalog
    asset = catalog.get_asset(image_id)
    if asset is None:
        return "missing"
    if asset.deleted_at is not None:
        return "trash"
    try:
        path = catalog.resolve_relative_path(asset.relative_path)
    except ApiError:
        return "missing"
    if asset.status != "available" or not path.exists() or not path.is_file():
        return "missing"
    return "active"


def _validate_candidate_asset(request: Request, image_id: str, job_id: str, view: str) -> None:
    catalog = request.app.state.asset_catalog
    asset = catalog.get_asset(image_id)
    if (
        asset is None
        or asset.asset_type != "image"
        or asset.source != "multiview"
        or asset.related_job_id != job_id
        or asset.view_name != view
    ):
        raise ApiError(400, "invalid_candidate_image", "Image is not a candidate for this view.")
    if _asset_state(request, image_id) != "active":
        raise ApiError(409, "asset_unavailable", "Image asset is not available.")


def _safe_model_path(root: Path, path: Path) -> Path:
    resolved = path.resolve()
    root_resolved = root.resolve()
    if not resolved.is_relative_to(root_resolved):
        raise ApiError(400, "invalid_path", "Invalid file path.")
    if not resolved.exists() or not resolved.is_file():
        raise ApiError(404, "model_not_found", "Generated GLB model was not found.")
    return resolved


def _new_attempt_id() -> str:
    import uuid

    return str(uuid.uuid4())
