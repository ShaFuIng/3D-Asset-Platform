import asyncio

from fastapi import APIRouter, Request, Response, status
from fastapi.responses import FileResponse

from ..errors import ApiError
from ..schemas import Create3DJobRequest, Create3DJobResponse, JobResponse, JobResult, JobStatus
from ..services.blender_client import BlenderClientError
from ..services.jobs import run_3d_job

router = APIRouter()


@router.post(
    "/api/3d/jobs",
    response_model=Create3DJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_3d_job(request: Request, payload: Create3DJobRequest) -> Create3DJobResponse:
    image = request.app.state.storage.get_image_by_id(payload.image_id)
    await request.app.state.comfy_client.ensure_available()
    request.app.state.comfy_client.load_workflow("preflight.png")
    job = await request.app.state.job_store.create()
    model_path = request.app.state.storage.model_path_for_job(job.job_id)
    if not getattr(request.app.state, "disable_background_jobs", False):
        usage_lease = request.app.state.asset_usage_guard.acquire(
            image.image_id,
            owner=f"single-job:{job.job_id}",
            reason="single_reference_image",
        )
        try:
            task = asyncio.create_task(
                run_3d_job(
                    job.job_id,
                    image,
                    model_path,
                    request.app.state.job_store,
                    request.app.state.comfy_client,
                    request.app.state.storage,
                    usage_lease,
                )
            )
            request.app.state.background_tasks.add(task)
            task.add_done_callback(request.app.state.background_tasks.discard)
        except Exception:
            usage_lease.release()
            raise
    return Create3DJobResponse(
        job_id=job.job_id,
        status=job.status,
        status_url=f"/api/3d/jobs/{job.job_id}",
    )


@router.get("/api/3d/jobs/{job_id}", response_model=JobResponse)
async def get_3d_job(request: Request, job_id: str) -> JobResponse:
    job = await request.app.state.job_store.get(job_id)
    if job is None:
        raise ApiError(404, "job_not_found", "3D generation job was not found.")
    return _job_response(job)


@router.get("/api/3d/jobs/{job_id}/model")
async def get_3d_model(request: Request, job_id: str) -> Response:
    job = await request.app.state.job_store.get(job_id)
    if job is None:
        raise ApiError(404, "job_not_found", "3D generation job was not found.")
    if job.status in {JobStatus.queued, JobStatus.running}:
        raise ApiError(409, "job_not_complete", "3D generation job is not complete.")
    if job.status == JobStatus.failed:
        raise ApiError(409, "job_failed", "3D generation job failed.")
    if job.model_path is None or not job.model_path.exists():
        raise ApiError(404, "model_not_found", "Generated GLB model was not found.")
    return FileResponse(
        job.model_path,
        media_type="model/gltf-binary",
        filename=f"{job.job_id}.glb",
    )


@router.get("/api/3d/jobs/{job_id}/usdz")
async def get_3d_model_usdz(request: Request, job_id: str) -> Response:
    job = await request.app.state.job_store.get(job_id)
    if job is None:
        raise ApiError(404, "job_not_found", "3D generation job was not found.")
    if job.status in {JobStatus.queued, JobStatus.running}:
        raise ApiError(409, "job_not_complete", "3D generation job is not complete.")
    if job.status == JobStatus.failed:
        raise ApiError(409, "job_failed", "3D generation job failed.")
    if job.model_path is None or not job.model_path.exists():
        raise ApiError(404, "model_not_found", "Generated GLB model was not found.")

    usdz_path = request.app.state.storage.usdz_path_for_job(job.job_id)
    if not usdz_path.exists():
        await _convert_to_usdz(request, job.model_path, usdz_path)

    return FileResponse(
        usdz_path,
        media_type="model/vnd.usdz+zip",
        filename=f"{job.job_id}.usdz",
    )


async def _convert_to_usdz(request: Request, glb_path, usdz_path) -> None:
    # Failure here must never fail the 3D job itself or affect the GLB
    # endpoint/Android Scene Viewer -- this is a separate, on-demand,
    # iOS-only conversion. Errors are surfaced as a distinct ApiError code,
    # not a raw 500, same spirit as the multiview geometry/textured
    # `available` split (see routers/multiview.py's _model_job_response).
    blender = request.app.state.blender_client
    if not blender.settings.blender_executable:
        raise ApiError(
            503,
            "blender_not_configured",
            "BLENDER_EXECUTABLE is not configured; USDZ export is unavailable.",
        )
    try:
        await blender.convert_glb_to_usdz(glb_path, usdz_path)
    except BlenderClientError as exc:
        raise ApiError(
            502,
            "usdz_conversion_failed",
            "Could not convert this model to USDZ for iOS AR.",
        ) from exc


def _job_response(job) -> JobResponse:
    result = None
    if job.status == JobStatus.succeeded:
        result = JobResult(model_url=f"/api/3d/jobs/{job.job_id}/model")
    return JobResponse(
        job_id=job.job_id,
        status=job.status,
        message=job.message,
        prompt_id=job.prompt_id,
        result=result,
    )
