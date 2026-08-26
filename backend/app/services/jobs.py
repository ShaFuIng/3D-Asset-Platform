import asyncio
import uuid
from dataclasses import dataclass
from pathlib import Path

from ..schemas import JobStatus
from ..storage import ImageRecord
from .comfy_client import ComfyClient, ComfyClientError


@dataclass(frozen=True)
class Job:
    job_id: str
    status: JobStatus
    message: str
    prompt_id: str | None
    model_path: Path | None
    asset_id: str | None = None


class JobStore:
    """In-memory job store for development only; it is reset on restart and not shared across workers."""

    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = asyncio.Lock()

    async def create(self) -> Job:
        job_id = str(uuid.uuid4())
        job = Job(
            job_id=job_id,
            status=JobStatus.queued,
            message="3D generation job is queued.",
            prompt_id=None,
            model_path=None,
        )
        async with self._lock:
            self._jobs[job_id] = job
        return job

    async def get(self, job_id: str) -> Job | None:
        async with self._lock:
            return self._jobs.get(job_id)

    async def update(
        self,
        job_id: str,
        *,
        status: JobStatus | None = None,
        message: str | None = None,
        prompt_id: str | None = None,
        model_path: Path | None = None,
        asset_id: str | None = None,
    ) -> Job | None:
        async with self._lock:
            current = self._jobs.get(job_id)
            if current is None:
                return None
            updated = Job(
                job_id=current.job_id,
                status=status or current.status,
                message=message or current.message,
                prompt_id=prompt_id if prompt_id is not None else current.prompt_id,
                model_path=model_path if model_path is not None else current.model_path,
                asset_id=asset_id if asset_id is not None else current.asset_id,
            )
            self._jobs[job_id] = updated
            return updated


async def run_3d_job(
    job_id: str,
    image: ImageRecord,
    model_path: Path,
    store: JobStore,
    comfy: ComfyClient,
    asset_storage=None,
    usage_lease=None,
) -> None:
    try:
        await store.update(job_id, status=JobStatus.running, message="3D generation job is running.")
        comfy_image_name = await comfy.upload_image(image.path)
        workflow = comfy.load_workflow(comfy_image_name)
        prompt_id = await comfy.queue_prompt(workflow, client_id=job_id)
        await store.update(job_id, prompt_id=prompt_id)
        output = await comfy.wait_for_glb_output(prompt_id)
        await comfy.download_output(output, model_path)
        asset_id = None
        if asset_storage is not None:
            registered_asset = asset_storage.register_model_file(
                model_path,
                source="generated",
                pipeline="single",
                model_variant="single",
                related_job_id=job_id,
                reference_image_id=image.image_id,
            )
            asset_id = registered_asset.asset_id
        await store.update(
            job_id,
            status=JobStatus.succeeded,
            message="3D model generation completed.",
            model_path=model_path,
            asset_id=asset_id,
        )
    except (ComfyClientError, Exception) as exc:
        await store.update(
            job_id,
            status=JobStatus.failed,
            message=_safe_failure_message(exc),
        )
    finally:
        if usage_lease is not None:
            usage_lease.release()


def _safe_failure_message(exc: Exception) -> str:
    if isinstance(exc, ComfyClientError):
        return str(exc)
    return "3D generation failed."

