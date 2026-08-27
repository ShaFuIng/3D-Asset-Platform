import asyncio
import struct

import pytest
from fastapi.testclient import TestClient

from app.errors import ApiError
from app.schemas import JobStatus
from app.services.comfy_client import ComfyClient, ComfyClientError
from app.services.jobs import run_3d_job
from tests.conftest import FakeBlenderClient, FakeComfyClient, GLB_BYTES, make_job


def test_create_3d_job_success(client: TestClient, image_id: str) -> None:
    response = client.post("/api/3d/jobs", json={"image_id": image_id})
    assert response.status_code == 202
    data = response.json()
    assert data["job_id"]
    assert data["status"] == "queued"
    assert data["status_url"] == f"/api/3d/jobs/{data['job_id']}"
    assert data["asset_id"] is None


def test_create_3d_job_keeps_background_task_reference(
    client: TestClient, image_id: str, monkeypatch
) -> None:
    class FakeTask:
        def __init__(self) -> None:
            self.callback = None

        def add_done_callback(self, callback) -> None:
            self.callback = callback

    task = FakeTask()

    def fake_create_task(coroutine):
        coroutine.close()
        return task

    monkeypatch.setattr("app.routers.jobs_3d.asyncio.create_task", fake_create_task)
    client.app.state.disable_background_jobs = False

    response = client.post("/api/3d/jobs", json={"image_id": image_id})

    assert response.status_code == 202
    assert task in client.app.state.background_tasks
    task.callback(task)
    assert task not in client.app.state.background_tasks


def test_create_3d_job_missing_image_returns_404(client: TestClient) -> None:
    response = client.post("/api/3d/jobs", json={"image_id": "missing"})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "image_not_found"


def test_create_3d_job_workflow_error_returns_500(client: TestClient, image_id: str) -> None:
    client.app.state.comfy_client = FakeComfyClient(
        workflow_error=ApiError(500, "workflow_invalid", "Workflow node 2 image input is missing.")
    )
    response = client.post("/api/3d/jobs", json={"image_id": image_id})
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "workflow_invalid"


def test_job_status_schema_for_all_states(client: TestClient, tmp_path) -> None:
    async def prepare():
        for status in JobStatus:
            job = await client.app.state.job_store.create()
            model_path = tmp_path / f"{job.job_id}.glb"
            if status == JobStatus.succeeded:
                model_path.write_bytes(GLB_BYTES)
            await client.app.state.job_store.update(
                job.job_id,
                status=status,
                message=f"job is {status.value}",
                prompt_id="prompt-123" if status != JobStatus.queued else None,
                model_path=model_path if status == JobStatus.succeeded else None,
                asset_id="asset-xyz" if status == JobStatus.succeeded else None,
            )
            response = client.get(f"/api/3d/jobs/{job.job_id}")
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == status.value
            if status == JobStatus.succeeded:
                assert data["result"]["model_url"] == f"/api/3d/jobs/{job.job_id}/model"
                assert data["asset_id"] == "asset-xyz"
            else:
                assert data["result"] is None
                assert data["asset_id"] is None

    asyncio.run(prepare())


def test_completed_job_can_download_model(client: TestClient, tmp_path) -> None:
    async def prepare():
        job = await client.app.state.job_store.create()
        model_path = tmp_path / f"{job.job_id}.glb"
        model_path.write_bytes(GLB_BYTES)
        await client.app.state.job_store.update(
            job.job_id,
            status=JobStatus.succeeded,
            message="3D model generation completed.",
            model_path=model_path,
        )
        return job.job_id

    job_id = asyncio.run(prepare())
    response = client.get(f"/api/3d/jobs/{job_id}/model")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("model/gltf-binary")
    assert response.content == GLB_BYTES


def test_unfinished_job_model_returns_409(client: TestClient) -> None:
    async def prepare():
        job = await client.app.state.job_store.create()
        await client.app.state.job_store.update(job.job_id, status=JobStatus.running)
        return job.job_id

    job_id = asyncio.run(prepare())
    response = client.get(f"/api/3d/jobs/{job_id}/model")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "job_not_complete"


def _prepare_succeeded_job(client: TestClient, tmp_path) -> str:
    async def prepare():
        job = await client.app.state.job_store.create()
        model_path = tmp_path / f"{job.job_id}.glb"
        model_path.write_bytes(GLB_BYTES)
        await client.app.state.job_store.update(
            job.job_id,
            status=JobStatus.succeeded,
            message="3D model generation completed.",
            model_path=model_path,
        )
        return job.job_id

    return asyncio.run(prepare())


def test_completed_job_usdz_converts_once_and_caches(client: TestClient, tmp_path) -> None:
    job_id = _prepare_succeeded_job(client, tmp_path)
    blender = client.app.state.blender_client
    assert isinstance(blender, FakeBlenderClient)

    first_response = client.get(f"/api/3d/jobs/{job_id}/usdz")
    second_response = client.get(f"/api/3d/jobs/{job_id}/usdz")

    assert first_response.status_code == 200
    assert first_response.headers["content-type"].startswith("model/vnd.usdz+zip")
    assert first_response.content == second_response.content
    assert second_response.status_code == 200
    # Converted exactly once -- the second request must be served from the
    # cached file on disk, not trigger another Blender run.
    assert len(blender.calls) == 1


def test_unfinished_job_usdz_returns_409(client: TestClient) -> None:
    async def prepare():
        job = await client.app.state.job_store.create()
        await client.app.state.job_store.update(job.job_id, status=JobStatus.running)
        return job.job_id

    job_id = asyncio.run(prepare())
    response = client.get(f"/api/3d/jobs/{job_id}/usdz")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "job_not_complete"


def test_completed_job_usdz_without_blender_configured_returns_503(
    client: TestClient, tmp_path
) -> None:
    job_id = _prepare_succeeded_job(client, tmp_path)
    client.app.state.blender_client = FakeBlenderClient(configured=False)

    response = client.get(f"/api/3d/jobs/{job_id}/usdz")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "blender_not_configured"


def test_completed_job_usdz_conversion_failure_returns_502_without_failing_job(
    client: TestClient, tmp_path
) -> None:
    from app.services.blender_client import BlenderClientError

    job_id = _prepare_succeeded_job(client, tmp_path)
    client.app.state.blender_client = FakeBlenderClient(
        error=BlenderClientError("Blender GLB to USDZ conversion failed: boom")
    )

    usdz_response = client.get(f"/api/3d/jobs/{job_id}/usdz")
    job_response = client.get(f"/api/3d/jobs/{job_id}")
    model_response = client.get(f"/api/3d/jobs/{job_id}/model")

    assert usdz_response.status_code == 502
    assert usdz_response.json()["error"]["code"] == "usdz_conversion_failed"
    # A failed USDZ conversion must not touch the job itself or the GLB
    # download / Android Scene Viewer path.
    assert job_response.status_code == 200
    assert job_response.json()["status"] == "succeeded"
    assert model_response.status_code == 200
    assert model_response.content == GLB_BYTES


def test_workflow_node_2_replacement(settings) -> None:
    client = ComfyClient(settings)
    settings.workflow_path.parent.mkdir(parents=True)
    settings.workflow_path.write_text(
        '{"2":{"inputs":{"image":"old.png"}},"10":{"class_type":"SaveGLB","inputs":{"filename_prefix":"mesh/Chat3D"}}}',
        encoding="utf-8",
    )
    workflow = client.load_workflow("new.png")
    assert workflow["2"]["inputs"]["image"] == "new.png"
    assert workflow["10"]["inputs"]["filename_prefix"] == "mesh/Chat3D"


def test_node_10_glb_output_parsing(settings) -> None:
    client = ComfyClient(settings)
    output = {"glb": [{"filename": "model.glb", "subfolder": "mesh", "type": "output"}]}
    assert client.parse_glb_output(output) == {
        "filename": "model.glb",
        "subfolder": "mesh",
        "type": "output",
    }


def test_node_10_glb_output_skips_non_glb_files(settings) -> None:
    client = ComfyClient(settings)
    output = {
        "files": [
            {"filename": "preview.png", "subfolder": "mesh", "type": "output"},
            {"filename": "model.GLB", "subfolder": "mesh", "type": "output"},
        ]
    }
    assert client.parse_glb_output(output) == {
        "filename": "model.GLB",
        "subfolder": "mesh",
        "type": "output",
    }


@pytest.mark.parametrize(
    "content",
    [
        b"",
        b"not-a-glb",
        b"glTF" + struct.pack("<II", 1, 12),
        b"glTF" + struct.pack("<II", 2, 20),
    ],
)
def test_glb_validation_rejects_invalid_content(settings, content: bytes) -> None:
    assert ComfyClient(settings)._is_valid_glb(content) is False


def test_glb_validation_accepts_version_2_header(settings) -> None:
    assert ComfyClient(settings)._is_valid_glb(GLB_BYTES) is True


def test_download_output_rejects_invalid_glb_without_writing(settings, tmp_path, monkeypatch) -> None:
    class FakeResponse:
        content = b"not-a-glb"

        def raise_for_status(self) -> None:
            pass

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args) -> None:
            pass

        async def get(self, *args, **kwargs):
            return FakeResponse()

    monkeypatch.setattr("app.services.comfy_client.httpx.AsyncClient", FakeAsyncClient)
    destination = tmp_path / "model.glb"

    with pytest.raises(ComfyClientError, match="invalid GLB"):
        asyncio.run(
            ComfyClient(settings).download_output(
                {"filename": "model.glb", "subfolder": "", "type": "output"},
                destination,
            )
        )

    assert not destination.exists()


def test_download_output_writes_valid_glb(settings, tmp_path, monkeypatch) -> None:
    class FakeResponse:
        content = GLB_BYTES

        def raise_for_status(self) -> None:
            pass

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args) -> None:
            pass

        async def get(self, *args, **kwargs):
            return FakeResponse()

    monkeypatch.setattr("app.services.comfy_client.httpx.AsyncClient", FakeAsyncClient)
    destination = tmp_path / "model.glb"

    asyncio.run(
        ComfyClient(settings).download_output(
            {"filename": "model.glb", "subfolder": "", "type": "output"},
            destination,
        )
    )

    assert destination.read_bytes() == GLB_BYTES


def test_comfyui_timeout_updates_job_failed(client: TestClient, image_id: str) -> None:
    async def run():
        image = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.job_store.create()
        model_path = client.app.state.storage.model_path_for_job(job.job_id)
        await run_3d_job(
            job.job_id,
            image,
            model_path,
            client.app.state.job_store,
            FakeComfyClient(timeout=True),
            client.app.state.storage,
        )
        return await client.app.state.job_store.get(job.job_id)

    job = asyncio.run(run())
    assert job.status == JobStatus.failed
    assert job.message == "Timed out waiting for Hunyuan3D."


def test_run_3d_job_succeeds(client: TestClient, image_id: str) -> None:
    usage_lease = client.app.state.asset_usage_guard.acquire(
        image_id,
        owner="test-single-job",
        reason="single_reference_image",
    )

    async def run():
        image = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.job_store.create()
        model_path = client.app.state.storage.model_path_for_job(job.job_id)
        assert client.app.state.asset_usage_guard.is_in_use(image_id)
        await run_3d_job(
            job.job_id,
            image,
            model_path,
            client.app.state.job_store,
            FakeComfyClient(),
            client.app.state.storage,
            usage_lease,
        )
        return await client.app.state.job_store.get(job.job_id)

    job = asyncio.run(run())
    assert job.status == JobStatus.succeeded
    assert job.prompt_id == "prompt-123"
    assert job.model_path.exists()
    assets = client.app.state.asset_catalog.find_references(image_id)
    models = [asset for asset in assets if asset.asset_type == "model"]
    assert len(models) == 1
    assert models[0].pipeline == "single"
    assert models[0].model_variant == "single"
    assert models[0].related_job_id == job.job_id
    assert not client.app.state.asset_usage_guard.is_in_use(image_id)
    # asset_id on the Job/JobResponse must be the *real* asset_id register_model_file()
    # assigned in the catalog, not some placeholder -- this is what Phase 4's
    # calibration feature will use as its key.
    assert job.asset_id == models[0].asset_id
    response = client.get(f"/api/3d/jobs/{job.job_id}")
    assert response.json()["asset_id"] == models[0].asset_id


def test_queued_single_job_does_not_register_model_asset(client: TestClient, image_id: str) -> None:
    response = client.post("/api/3d/jobs", json={"image_id": image_id})
    assert response.status_code == 202

    models = [
        asset
        for asset in client.app.state.asset_catalog.find_references(image_id)
        if asset.asset_type == "model"
    ]
    assert models == []
    assert not client.app.state.asset_usage_guard.is_in_use(image_id)


def test_single_job_fails_when_model_catalog_registration_fails(client: TestClient, image_id: str) -> None:
    class FailingCatalog:
        def relative_path_for(self, path):
            return "models/model.glb"

        def upsert_asset(self, record):
            raise RuntimeError("database unavailable")

    async def run():
        image = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.job_store.create()
        model_path = client.app.state.storage.model_path_for_job(job.job_id)
        original = client.app.state.storage.asset_catalog
        client.app.state.storage.asset_catalog = FailingCatalog()
        try:
            await run_3d_job(
                job.job_id,
                image,
                model_path,
                client.app.state.job_store,
                FakeComfyClient(),
                client.app.state.storage,
            )
        finally:
            client.app.state.storage.asset_catalog = original
        return await client.app.state.job_store.get(job.job_id)

    job = asyncio.run(run())
    assert job.status == JobStatus.failed
    assert job.model_path is None
