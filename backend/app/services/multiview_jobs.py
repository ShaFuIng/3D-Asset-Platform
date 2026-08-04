import asyncio
import uuid
from dataclasses import dataclass
from pathlib import Path

from ..errors import ApiError
from ..schemas import JobStatus
from ..storage import ImageRecord
from .comfy_client import ComfyClient, ComfyClientError
from .multiview_workflows import HunyuanMultiviewWorkflow, QwenMultiviewWorkflow, VIEW_ORDER


@dataclass(frozen=True)
class StoredImage:
    image_id: str
    filename: str


@dataclass(frozen=True)
class MultiviewSlot:
    view: str
    status: JobStatus
    current_image: StoredImage | None
    candidate_image: StoredImage | None
    accepted: bool
    error: str | None
    provider: str


@dataclass(frozen=True)
class MultiviewModelJob:
    status: JobStatus
    message: str
    prompt_id: str | None
    geometry_path: Path | None
    textured_path: Path | None


@dataclass(frozen=True)
class MultiviewJob:
    job_id: str
    status: JobStatus
    message: str
    provider: str
    reference_image: StoredImage
    prompt_id: str | None
    views: dict[str, MultiviewSlot]
    model_job: MultiviewModelJob | None


class MultiviewJobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, MultiviewJob] = {}
        self._lock = asyncio.Lock()

    async def create(self, reference: ImageRecord, provider: str) -> MultiviewJob:
        job_id = str(uuid.uuid4())
        job = MultiviewJob(
            job_id=job_id,
            status=JobStatus.queued,
            message="Multiview image generation job is queued.",
            provider=provider,
            reference_image=StoredImage(image_id=reference.image_id, filename=reference.filename),
            prompt_id=None,
            views={
                view: MultiviewSlot(
                    view=view,
                    status=JobStatus.queued,
                    current_image=None,
                    candidate_image=None,
                    accepted=False,
                    error=None,
                    provider=provider,
                )
                for view in VIEW_ORDER
            },
            model_job=None,
        )
        async with self._lock:
            self._jobs[job_id] = job
        return job

    async def get(self, job_id: str) -> MultiviewJob | None:
        async with self._lock:
            return self._jobs.get(job_id)

    async def update_images_running(self, job_id: str, prompt_id: str | None = None) -> MultiviewJob | None:
        return await self._update(
            job_id,
            status=JobStatus.running,
            message="Multiview image generation job is running.",
            prompt_id=prompt_id,
            views={
                view: _replace_slot(slot, status=JobStatus.running)
                for view, slot in (await self._require(job_id)).views.items()
            },
        )

    async def set_images_succeeded(
        self,
        job_id: str,
        images: dict[str, ImageRecord],
    ) -> MultiviewJob | None:
        current = await self._require(job_id)
        return await self._update(
            job_id,
            status=JobStatus.succeeded,
            message="Multiview images generated.",
            views={
                view: _replace_slot(
                    current.views[view],
                    status=JobStatus.succeeded,
                    current_image=StoredImage(image_id=images[view].image_id, filename=images[view].filename),
                    error=None,
                )
                for view in VIEW_ORDER
            },
        )

    async def set_failed(self, job_id: str, message: str) -> MultiviewJob | None:
        current = await self._require(job_id)
        return await self._update(
            job_id,
            status=JobStatus.failed,
            message=message,
            views={
                view: _replace_slot(slot, status=JobStatus.failed, error=message)
                if slot.current_image is None
                else slot
                for view, slot in current.views.items()
            },
        )

    async def accept_view(self, job_id: str, view: str) -> MultiviewJob:
        current = await self._require(job_id)
        slot = _require_view(current, view)
        image = slot.candidate_image or slot.current_image
        if image is None:
            raise ApiError(409, "view_not_ready", "View image is not ready.")
        updated_slot = _replace_slot(
            slot,
            current_image=image,
            candidate_image=None,
            accepted=True,
            status=JobStatus.succeeded,
            error=None,
        )
        updated = await self._update(job_id, views={**current.views, view: updated_slot})
        if updated is None:
            raise ApiError(404, "multiview_job_not_found", "Multiview job was not found.")
        return updated

    async def set_candidate(self, job_id: str, view: str, image: ImageRecord) -> MultiviewJob:
        current = await self._require(job_id)
        slot = _require_view(current, view)
        updated_slot = _replace_slot(
            slot,
            status=JobStatus.succeeded,
            candidate_image=StoredImage(image_id=image.image_id, filename=image.filename),
            error=None,
        )
        updated = await self._update(job_id, views={**current.views, view: updated_slot})
        if updated is None:
            raise ApiError(404, "multiview_job_not_found", "Multiview job was not found.")
        return updated

    async def start_model_job(self, job_id: str) -> MultiviewJob:
        current = await self._require(job_id)
        _validate_model_start(current)
        model_job = MultiviewModelJob(
            status=JobStatus.queued,
            message="Multiview 3D generation job is queued.",
            prompt_id=None,
            geometry_path=None,
            textured_path=None,
        )
        updated = await self._update(job_id, model_job=model_job)
        if updated is None:
            raise ApiError(404, "multiview_job_not_found", "Multiview job was not found.")
        return updated

    async def update_model_job(
        self,
        job_id: str,
        *,
        status: JobStatus | None = None,
        message: str | None = None,
        prompt_id: str | None = None,
        geometry_path: Path | None = None,
        textured_path: Path | None = None,
    ) -> MultiviewJob | None:
        current = await self._require(job_id)
        if current.model_job is None:
            return None
        model_job = MultiviewModelJob(
            status=status or current.model_job.status,
            message=message or current.model_job.message,
            prompt_id=prompt_id if prompt_id is not None else current.model_job.prompt_id,
            geometry_path=geometry_path if geometry_path is not None else current.model_job.geometry_path,
            textured_path=textured_path if textured_path is not None else current.model_job.textured_path,
        )
        return await self._update(job_id, model_job=model_job)

    async def _require(self, job_id: str) -> MultiviewJob:
        job = await self.get(job_id)
        if job is None:
            raise ApiError(404, "multiview_job_not_found", "Multiview job was not found.")
        return job

    async def _update(
        self,
        job_id: str,
        *,
        status: JobStatus | None = None,
        message: str | None = None,
        prompt_id: str | None = None,
        views: dict[str, MultiviewSlot] | None = None,
        model_job: MultiviewModelJob | None = None,
    ) -> MultiviewJob | None:
        async with self._lock:
            current = self._jobs.get(job_id)
            if current is None:
                return None
            updated = MultiviewJob(
                job_id=current.job_id,
                status=status or current.status,
                message=message or current.message,
                provider=current.provider,
                reference_image=current.reference_image,
                prompt_id=prompt_id if prompt_id is not None else current.prompt_id,
                views=views if views is not None else current.views,
                model_job=model_job if model_job is not None else current.model_job,
            )
            self._jobs[job_id] = updated
            return updated


async def run_multiview_image_job(
    job_id: str,
    reference: ImageRecord,
    store: MultiviewJobStore,
    comfy: ComfyClient,
    qwen: QwenMultiviewWorkflow,
    asset_storage,
    usage_lease=None,
) -> None:
    try:
        await store.update_images_running(job_id)
        comfy_image_name = await comfy.upload_image(reference.path)
        workflow = qwen.prepare_three_view_workflow(comfy_image_name)
        prompt_id = await comfy.queue_prompt(workflow, client_id=job_id)
        await store.update_images_running(job_id, prompt_id=prompt_id)
        history = await _wait_for_history(comfy, prompt_id)
        outputs = qwen.parse_three_view_outputs(history, prompt_id)
        images = {}
        for view, output in outputs.items():
            content = await comfy.download_output_bytes(output.as_dict())
            images[view] = asset_storage.save_image_bytes(
                content,
                f"qwen-{view}",
                ".png",
                source="multiview",
                related_job_id=job_id,
                reference_image_id=reference.image_id,
                view_name=view,
            )
        await store.set_images_succeeded(job_id, images)
    except (ApiError, ComfyClientError, Exception) as exc:
        await store.set_failed(job_id, _safe_failure_message(exc))
    finally:
        if usage_lease is not None:
            usage_lease.release()


async def run_multiview_model_job(
    job_id: str,
    store: MultiviewJobStore,
    comfy: ComfyClient,
    hunyuan: HunyuanMultiviewWorkflow,
    asset_storage,
    usage_lease=None,
) -> None:
    try:
        job = await store.get(job_id)
        if job is None:
            return
        await store.update_model_job(
            job_id,
            status=JobStatus.running,
            message="Multiview 3D generation job is running.",
        )
        comfy_names = {}
        for view in VIEW_ORDER:
            image = job.views[view].current_image
            if image is None:
                raise ApiError(409, "view_not_ready", "All views must have images.")
            record = asset_storage.get_image_by_id(image.image_id)
            comfy_names[view] = await comfy.upload_image(record.path)
        workflow = hunyuan.prepare_workflow(
            front=comfy_names["front"],
            left=comfy_names["left"],
            back=comfy_names["back"],
        )
        prompt_id = await comfy.queue_prompt(workflow, client_id=f"{job_id}-model")
        await store.update_model_job(job_id, prompt_id=prompt_id)
        history = await _wait_for_history(comfy, prompt_id)
        outputs = hunyuan.parse_model_outputs(history, prompt_id)
        geometry_path = asset_storage.models_dir / f"{job_id}-geometry.glb"
        textured_path = asset_storage.models_dir / f"{job_id}-textured.glb"
        await comfy.download_output(outputs["geometry"].as_dict(), geometry_path)
        asset_storage.register_model_file(
            geometry_path,
            source="generated",
            pipeline="multiview",
            model_variant="geometry",
            related_job_id=job_id,
            reference_image_id=job.reference_image.image_id,
        )
        await comfy.download_output(outputs["textured"].as_dict(), textured_path)
        asset_storage.register_model_file(
            textured_path,
            source="generated",
            pipeline="multiview",
            model_variant="textured",
            related_job_id=job_id,
            reference_image_id=job.reference_image.image_id,
        )
        await store.update_model_job(
            job_id,
            status=JobStatus.succeeded,
            message="Multiview 3D generation completed.",
            geometry_path=geometry_path,
            textured_path=textured_path,
        )
    except (ApiError, ComfyClientError, Exception) as exc:
        await store.update_model_job(
            job_id,
            status=JobStatus.failed,
            message=_safe_failure_message(exc),
        )
    finally:
        if usage_lease is not None:
            usage_lease.release()


async def _wait_for_history(comfy: ComfyClient, prompt_id: str) -> dict:
    deadline = asyncio.get_running_loop().time() + comfy.settings.comfyui_job_timeout_seconds
    while asyncio.get_running_loop().time() < deadline:
        history = await comfy.history(prompt_id)
        job = history.get(prompt_id)
        if job is None:
            await asyncio.sleep(comfy.settings.comfyui_poll_interval_seconds)
            continue
        if job.get("status", {}).get("status_str") == "error":
            raise ComfyClientError("ComfyUI workflow failed.")
        if job.get("outputs"):
            return history
        await asyncio.sleep(comfy.settings.comfyui_poll_interval_seconds)
    raise ComfyClientError("Timed out waiting for ComfyUI workflow.")


def _replace_slot(slot: MultiviewSlot, **updates) -> MultiviewSlot:
    values = {
        "view": slot.view,
        "status": slot.status,
        "current_image": slot.current_image,
        "candidate_image": slot.candidate_image,
        "accepted": slot.accepted,
        "error": slot.error,
        "provider": slot.provider,
    }
    values.update(updates)
    return MultiviewSlot(**values)


def _require_view(job: MultiviewJob, view: str) -> MultiviewSlot:
    if view not in VIEW_ORDER:
        raise ApiError(400, "invalid_view", "View must be front, left, or back.")
    return job.views[view]


def _validate_model_start(job: MultiviewJob) -> None:
    for view in VIEW_ORDER:
        slot = job.views[view]
        if slot.current_image is None:
            raise ApiError(409, "view_not_ready", "All views must have images.")
        if not slot.accepted:
            raise ApiError(409, "views_not_accepted", "All views must be accepted before generating 3D.")
        if slot.candidate_image is not None:
            raise ApiError(409, "candidate_pending", "Accept or discard candidate images before generating 3D.")
    if job.model_job and job.model_job.status in {JobStatus.queued, JobStatus.running}:
        raise ApiError(409, "model_job_running", "Multiview 3D generation job is already running.")


def _safe_failure_message(exc: Exception) -> str:
    if isinstance(exc, ApiError):
        return exc.message
    if isinstance(exc, ComfyClientError):
        return str(exc)
    return "Multiview generation failed."
