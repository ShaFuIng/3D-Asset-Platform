import asyncio

import pytest
from fastapi.testclient import TestClient

from app.errors import ApiError
from app.schemas import JobStatus
from app.services.comfy_client import ComfyClient, ComfyClientError
from app.services.jobs import run_3d_job
from tests.conftest import FakeComfyClient, make_job


def test_create_3d_job_success(client: TestClient, image_id: str) -> None:
    response = client.post("/api/3d/jobs", json={"image_id": image_id})
    assert response.status_code == 202
    data = response.json()
    assert data["job_id"]
    assert data["status"] == "queued"
    assert data["status_url"] == f"/api/3d/jobs/{data['job_id']}"


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
                model_path.write_bytes(b"glb-data")
            await client.app.state.job_store.update(
                job.job_id,
                status=status,
                message=f"job is {status.value}",
                prompt_id="prompt-123" if status != JobStatus.queued else None,
                model_path=model_path if status == JobStatus.succeeded else None,
            )
            response = client.get(f"/api/3d/jobs/{job.job_id}")
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == status.value
            if status == JobStatus.succeeded:
                assert data["result"]["model_url"] == f"/api/3d/jobs/{job.job_id}/model"
            else:
                assert data["result"] is None

    asyncio.run(prepare())


def test_completed_job_can_download_model(client: TestClient, tmp_path) -> None:
    async def prepare():
        job = await client.app.state.job_store.create()
        model_path = tmp_path / f"{job.job_id}.glb"
        model_path.write_bytes(b"glb-data")
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
    assert response.content == b"glb-data"


def test_unfinished_job_model_returns_409(client: TestClient) -> None:
    async def prepare():
        job = await client.app.state.job_store.create()
        await client.app.state.job_store.update(job.job_id, status=JobStatus.running)
        return job.job_id

    job_id = asyncio.run(prepare())
    response = client.get(f"/api/3d/jobs/{job_id}/model")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "job_not_complete"


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
        )
        return await client.app.state.job_store.get(job.job_id)

    job = asyncio.run(run())
    assert job.status == JobStatus.failed
    assert job.message == "Timed out waiting for Hunyuan3D."


def test_run_3d_job_succeeds(client: TestClient, image_id: str) -> None:
    async def run():
        image = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.job_store.create()
        model_path = client.app.state.storage.model_path_for_job(job.job_id)
        await run_3d_job(
            job.job_id,
            image,
            model_path,
            client.app.state.job_store,
            FakeComfyClient(),
        )
        return await client.app.state.job_store.get(job.job_id)

    job = asyncio.run(run())
    assert job.status == JobStatus.succeeded
    assert job.prompt_id == "prompt-123"
    assert job.model_path.exists()

