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
)
from ..services.multiview_jobs import (
    MultiviewJob,
    run_multiview_image_job,
    run_multiview_model_job,
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
    await request.app.state.comfy_client.ensure_available()
    request.app.state.qwen_multiview_workflow.prepare_three_view_workflow("preflight.png")
    job = await request.app.state.multiview_job_store.create(reference, payload.provider)
    if not getattr(request.app.state, "disable_background_jobs", False):
        task = asyncio.create_task(
            run_multiview_image_job(
                job.job_id,
                reference,
                request.app.state.multiview_job_store,
                request.app.state.comfy_client,
                request.app.state.qwen_multiview_workflow,
                request.app.state.storage,
            )
        )
        request.app.state.background_tasks.add(task)
        task.add_done_callback(request.app.state.background_tasks.discard)
    return CreateMultiviewJobResponse(
        job_id=job.job_id,
        status=job.status,
        provider=job.provider,
        status_url=f"/api/multiview/jobs/{job.job_id}",
    )


@router.get("/api/multiview/jobs/{job_id}", response_model=MultiviewJobResponse)
async def get_multiview_job(request: Request, job_id: str) -> MultiviewJobResponse:
    job = await _get_job(request, job_id)
    return _job_response(job)


@router.post(
    "/api/multiview/jobs/{job_id}/views/{view}/accept",
    response_model=MultiviewJobResponse,
)
async def accept_multiview_view(request: Request, job_id: str, view: str) -> MultiviewJobResponse:
    if view not in VIEW_ORDER:
        raise ApiError(400, "invalid_view", "View must be front, left, or back.")
    job = await request.app.state.multiview_job_store.accept_view(job_id, view)
    return _job_response(job)


@router.post("/api/multiview/jobs/{job_id}/views/{view}/regenerate")
async def regenerate_multiview_view(_request: Request, job_id: str, view: str) -> Response:
    _ = job_id
    if view not in VIEW_ORDER:
        raise ApiError(400, "invalid_view", "View must be front, left, or back.")
    raise ApiError(
        501,
        "regenerate_not_implemented",
        "Single-view regenerate needs ComfyUI validation that one prompt returns exactly one image.",
    )


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
        task = asyncio.create_task(
            run_multiview_model_job(
                job.job_id,
                request.app.state.multiview_job_store,
                request.app.state.comfy_client,
                request.app.state.hunyuan_multiview_workflow,
                request.app.state.storage,
            )
        )
        request.app.state.background_tasks.add(task)
        task.add_done_callback(request.app.state.background_tasks.discard)
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


async def _get_job(request: Request, job_id: str) -> MultiviewJob:
    job = await request.app.state.multiview_job_store.get(job_id)
    if job is None:
        raise ApiError(404, "multiview_job_not_found", "Multiview job was not found.")
    return job


def _job_response(job: MultiviewJob) -> MultiviewJobResponse:
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


def _safe_model_path(root: Path, path: Path) -> Path:
    resolved = path.resolve()
    root_resolved = root.resolve()
    if not resolved.is_relative_to(root_resolved):
        raise ApiError(400, "invalid_path", "Invalid file path.")
    if not resolved.exists() or not resolved.is_file():
        raise ApiError(404, "model_not_found", "Generated GLB model was not found.")
    return resolved
