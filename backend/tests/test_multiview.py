import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from app.errors import ApiError
from app.schemas import JobStatus
from app.services.multiview_jobs import run_multiview_image_job, run_multiview_model_job
from app.services.multiview_workflows import HunyuanMultiviewWorkflow, QwenMultiviewWorkflow
from tests.conftest import GLB_BYTES, PNG_BYTES


def qwen_template() -> dict:
    return {
        "41": {"inputs": {"image": "old.png"}, "class_type": "LoadImage"},
        "113": {"inputs": {"text": "old", "delimiter": ""}, "class_type": "TextToList"},
        "112:105": {"inputs": {"seed": 1}, "class_type": "KSampler"},
        "9": {"inputs": {"images": ["112:102", 0]}, "class_type": "SaveImage"},
    }


def hunyuan_template() -> dict:
    return {
        "157": {"inputs": {"image": "old-front.png"}, "class_type": "LoadImage"},
        "160": {"inputs": {"image": "old-left.png"}, "class_type": "LoadImage"},
        "159": {"inputs": {"image": "old-back.png"}, "class_type": "LoadImage"},
        "166": {
            "inputs": {"front": ["195", 0], "left": ["196", 0], "back": ["198", 0], "seed": 1},
            "class_type": "Hy3DGenerateMeshMultiView",
        },
        "162": {"inputs": {"model_file": ["17", 0]}, "class_type": "Preview3D"},
        "154": {"inputs": {"model_file": ["99", 0]}, "class_type": "Preview3D"},
    }


def write_workflow(path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def image_output(filename: str) -> dict[str, str]:
    return {"filename": filename, "subfolder": "Qwen_3Views", "type": "output"}


def test_qwen_replaces_reference_without_mutating_template(settings) -> None:
    write_workflow(settings.qwen_multiview_workflow_path, qwen_template())
    adapter = QwenMultiviewWorkflow(settings.qwen_multiview_workflow_path)

    workflow = adapter.prepare_three_view_workflow("new.png", seed=42)
    original = json.loads(settings.qwen_multiview_workflow_path.read_text(encoding="utf-8"))

    assert workflow["41"]["inputs"]["image"] == "new.png"
    assert workflow["112:105"]["inputs"]["seed"] == 42
    assert original["41"]["inputs"]["image"] == "old.png"
    assert original["112:105"]["inputs"]["seed"] == 1


def test_qwen_parse_three_outputs_in_view_order(settings) -> None:
    write_workflow(settings.qwen_multiview_workflow_path, qwen_template())
    adapter = QwenMultiviewWorkflow(settings.qwen_multiview_workflow_path)
    history = {
        "prompt-1": {
            "outputs": {
                "9": {
                    "images": [
                        image_output("front.png"),
                        image_output("left.png"),
                        image_output("back.png"),
                    ]
                }
            }
        }
    }

    outputs = adapter.parse_three_view_outputs(history, "prompt-1")

    assert outputs["front"].filename == "front.png"
    assert outputs["left"].filename == "left.png"
    assert outputs["back"].filename == "back.png"


@pytest.mark.parametrize("count", [2, 4])
def test_qwen_parse_rejects_wrong_output_count(settings, count: int) -> None:
    write_workflow(settings.qwen_multiview_workflow_path, qwen_template())
    adapter = QwenMultiviewWorkflow(settings.qwen_multiview_workflow_path)
    history = {"prompt-1": {"outputs": {"9": {"images": [image_output(f"{i}.png") for i in range(count)]}}}}

    with pytest.raises(ApiError, match="exactly three"):
        adapter.parse_three_view_outputs(history, "prompt-1")


def test_qwen_parse_rejects_missing_fields(settings) -> None:
    write_workflow(settings.qwen_multiview_workflow_path, qwen_template())
    adapter = QwenMultiviewWorkflow(settings.qwen_multiview_workflow_path)
    history = {
        "prompt-1": {
            "outputs": {
                "9": {
                    "images": [
                        image_output("front.png"),
                        {"filename": "left.png", "type": "output"},
                        image_output("back.png"),
                    ]
                }
            }
        }
    }

    with pytest.raises(ApiError, match="filename, subfolder, and type"):
        adapter.parse_three_view_outputs(history, "prompt-1")


def test_hunyuan_replaces_three_inputs_and_does_not_enable_right(settings) -> None:
    write_workflow(settings.hunyuan_multiview_workflow_path, hunyuan_template())
    adapter = HunyuanMultiviewWorkflow(settings.hunyuan_multiview_workflow_path)

    workflow = adapter.prepare_workflow(front="front.png", left="left.png", back="back.png", seed=9)

    assert workflow["157"]["inputs"]["image"] == "front.png"
    assert workflow["160"]["inputs"]["image"] == "left.png"
    assert workflow["159"]["inputs"]["image"] == "back.png"
    assert workflow["166"]["inputs"]["seed"] == 9
    assert "167" not in workflow


def test_hunyuan_rejects_right_node_in_api_template(settings) -> None:
    template = hunyuan_template()
    template["167"] = {"inputs": {"image": "right.png"}, "class_type": "LoadImage"}
    write_workflow(settings.hunyuan_multiview_workflow_path, template)
    adapter = HunyuanMultiviewWorkflow(settings.hunyuan_multiview_workflow_path)

    with pytest.raises(ApiError, match="right view"):
        adapter.prepare_workflow(front="front.png", left="left.png", back="back.png")


def test_hunyuan_parse_geometry_and_textured_outputs(settings) -> None:
    write_workflow(settings.hunyuan_multiview_workflow_path, hunyuan_template())
    adapter = HunyuanMultiviewWorkflow(settings.hunyuan_multiview_workflow_path)
    history = {
        "prompt-1": {
            "outputs": {
                "162": {"result": ["3D/Hy3D_00001_.glb"]},
                "154": {"result": [{"filename": "Hy3D_textured.glb", "subfolder": "3D", "type": "output"}]},
            }
        }
    }

    outputs = adapter.parse_model_outputs(history, "prompt-1")

    assert outputs["geometry"].filename == "Hy3D_00001_.glb"
    assert outputs["geometry"].subfolder == "3D"
    assert outputs["textured"].filename == "Hy3D_textured.glb"


def prepare_multiview_app(client: TestClient) -> None:
    settings = client.app.state.settings
    write_workflow(settings.qwen_multiview_workflow_path, qwen_template())
    write_workflow(settings.hunyuan_multiview_workflow_path, hunyuan_template())
    client.app.state.qwen_multiview_workflow = QwenMultiviewWorkflow(settings.qwen_multiview_workflow_path)
    client.app.state.hunyuan_multiview_workflow = HunyuanMultiviewWorkflow(settings.hunyuan_multiview_workflow_path)


def test_create_multiview_job_and_reject_invalid_view(client: TestClient, image_id: str) -> None:
    prepare_multiview_app(client)
    response = client.post(
        "/api/multiview/jobs",
        json={"reference_image_id": image_id, "provider": "local"},
    )
    assert response.status_code == 202
    job_id = response.json()["job_id"]

    invalid = client.post(f"/api/multiview/jobs/{job_id}/views/side/accept")

    assert invalid.status_code == 400
    assert invalid.json()["error"]["code"] == "invalid_view"


def test_model_job_requires_all_views_accepted(client: TestClient, image_id: str) -> None:
    prepare_multiview_app(client)
    created = client.post("/api/multiview/jobs", json={"reference_image_id": image_id}).json()

    response = client.post(f"/api/multiview/jobs/{created['job_id']}/model-job")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "view_not_ready"


def test_model_job_rejects_pending_candidate(client: TestClient, image_id: str) -> None:
    prepare_multiview_app(client)

    async def prepare():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = {
            view: client.app.state.storage.save_image_bytes(PNG_BYTES, view, ".png")
            for view in ("front", "left", "back")
        }
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        for view in ("front", "left", "back"):
            await client.app.state.multiview_job_store.accept_view(job.job_id, view)
        candidate = client.app.state.storage.save_image_bytes(PNG_BYTES, "candidate", ".png")
        await client.app.state.multiview_job_store.set_candidate(job.job_id, "left", candidate)
        return job.job_id

    job_id = asyncio.run(prepare())
    response = client.post(f"/api/multiview/jobs/{job_id}/model-job")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "candidate_pending"


def test_multiview_model_downloads(client: TestClient, image_id: str) -> None:
    prepare_multiview_app(client)

    async def prepare():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = {
            view: client.app.state.storage.save_image_bytes(PNG_BYTES, view, ".png")
            for view in ("front", "left", "back")
        }
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        for view in ("front", "left", "back"):
            await client.app.state.multiview_job_store.accept_view(job.job_id, view)
        await client.app.state.multiview_job_store.start_model_job(job.job_id)
        geometry = client.app.state.storage.models_dir / f"{job.job_id}-geometry.glb"
        textured = client.app.state.storage.models_dir / f"{job.job_id}-textured.glb"
        geometry.write_bytes(GLB_BYTES)
        textured.write_bytes(GLB_BYTES)
        await client.app.state.multiview_job_store.update_model_job(
            job.job_id,
            status=JobStatus.succeeded,
            geometry_path=geometry,
            textured_path=textured,
        )
        return job.job_id

    job_id = asyncio.run(prepare())

    geometry_response = client.get(f"/api/multiview/jobs/{job_id}/models/geometry")
    textured_response = client.get(f"/api/multiview/jobs/{job_id}/models/textured")

    assert geometry_response.status_code == 200
    assert geometry_response.content == GLB_BYTES
    assert textured_response.status_code == 200
    assert textured_response.content == GLB_BYTES


def test_multiview_model_download_rejects_path_escape(client: TestClient, image_id: str, tmp_path) -> None:
    prepare_multiview_app(client)

    async def prepare():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = {
            view: client.app.state.storage.save_image_bytes(PNG_BYTES, view, ".png")
            for view in ("front", "left", "back")
        }
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        for view in ("front", "left", "back"):
            await client.app.state.multiview_job_store.accept_view(job.job_id, view)
        await client.app.state.multiview_job_store.start_model_job(job.job_id)
        escaped = tmp_path / "escaped.glb"
        escaped.write_bytes(GLB_BYTES)
        await client.app.state.multiview_job_store.update_model_job(
            job.job_id,
            status=JobStatus.succeeded,
            geometry_path=escaped,
        )
        return job.job_id

    job_id = asyncio.run(prepare())
    response = client.get(f"/api/multiview/jobs/{job_id}/models/geometry")

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_path"


class FakeMultiviewComfy:
    def __init__(self, settings) -> None:
        self.settings = settings
        self.workflows = []

    async def upload_image(self, image_path):
        return image_path.name

    async def queue_prompt(self, workflow, client_id: str):
        self.workflows.append(workflow)
        return "prompt-1"

    async def history(self, prompt_id: str):
        return {
            prompt_id: {
                "outputs": {
                    "9": {
                        "images": [
                            image_output("front.png"),
                            image_output("left.png"),
                            image_output("back.png"),
                        ]
                    },
                    "162": {"result": ["3D/Hy3D.glb"]},
                    "154": {"result": ["3D/Hy3D_textured.glb"]},
                }
            }
        }

    async def download_output_bytes(self, output):
        return PNG_BYTES

    async def download_output(self, output, destination):
        destination.write_bytes(GLB_BYTES)


def test_run_multiview_image_job_saves_distinct_assets(client: TestClient, image_id: str) -> None:
    prepare_multiview_app(client)

    async def run():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        await run_multiview_image_job(
            job.job_id,
            reference,
            client.app.state.multiview_job_store,
            FakeMultiviewComfy(client.app.state.settings),
            client.app.state.qwen_multiview_workflow,
            client.app.state.storage,
        )
        return await client.app.state.multiview_job_store.get(job.job_id)

    job = asyncio.run(run())

    assert job.status == JobStatus.succeeded
    assert {slot.current_image.image_id for slot in job.views.values()} != {image_id}
    assert len({slot.current_image.image_id for slot in job.views.values()}) == 3
    for view, slot in job.views.items():
        asset = client.app.state.asset_catalog.get_asset(slot.current_image.image_id)
        assert asset.source == "multiview"
        assert asset.view_name == view
        assert asset.related_job_id == job.job_id
        assert asset.reference_image_id == image_id


def test_run_multiview_model_job_saves_two_models(client: TestClient, image_id: str) -> None:
    prepare_multiview_app(client)

    async def run():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = {
            view: client.app.state.storage.save_image_bytes(PNG_BYTES, view, ".png")
            for view in ("front", "left", "back")
        }
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        for view in ("front", "left", "back"):
            await client.app.state.multiview_job_store.accept_view(job.job_id, view)
        await client.app.state.multiview_job_store.start_model_job(job.job_id)
        guarded_ids = [image_id, *(record.image_id for record in records.values())]
        usage_lease = client.app.state.asset_usage_guard.acquire_many(
            guarded_ids,
            owner="test-multiview-model",
            reason="multiview_model_inputs",
        )
        assert all(client.app.state.asset_usage_guard.is_in_use(asset_id) for asset_id in guarded_ids)
        await run_multiview_model_job(
            job.job_id,
            client.app.state.multiview_job_store,
            FakeMultiviewComfy(client.app.state.settings),
            client.app.state.hunyuan_multiview_workflow,
            client.app.state.storage,
            usage_lease,
        )
        return await client.app.state.multiview_job_store.get(job.job_id), guarded_ids

    job, guarded_ids = asyncio.run(run())

    assert job.model_job.status == JobStatus.succeeded
    assert job.model_job.geometry_path.exists()
    assert job.model_job.textured_path.exists()
    assert all(not client.app.state.asset_usage_guard.is_in_use(asset_id) for asset_id in guarded_ids)
    models = [
        asset
        for asset in client.app.state.asset_catalog.find_references(image_id)
        if asset.asset_type == "model"
    ]
    assert {model.model_variant for model in models} == {"geometry", "textured"}
    assert {model.pipeline for model in models} == {"multiview"}
    assert {model.related_job_id for model in models} == {job.job_id}


def test_run_multiview_model_job_keeps_geometry_asset_when_textured_download_fails(
    client: TestClient, image_id: str
) -> None:
    prepare_multiview_app(client)

    class TexturedFailingComfy(FakeMultiviewComfy):
        async def download_output(self, output, destination):
            if "textured" in output["filename"].lower():
                raise RuntimeError("download failed")
            destination.write_bytes(GLB_BYTES)

    async def run():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = {
            view: client.app.state.storage.save_image_bytes(PNG_BYTES, view, ".png")
            for view in ("front", "left", "back")
        }
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        for view in ("front", "left", "back"):
            await client.app.state.multiview_job_store.accept_view(job.job_id, view)
        await client.app.state.multiview_job_store.start_model_job(job.job_id)
        await run_multiview_model_job(
            job.job_id,
            client.app.state.multiview_job_store,
            TexturedFailingComfy(client.app.state.settings),
            client.app.state.hunyuan_multiview_workflow,
            client.app.state.storage,
        )
        return await client.app.state.multiview_job_store.get(job.job_id)

    job = asyncio.run(run())
    models = [
        asset
        for asset in client.app.state.asset_catalog.find_references(image_id)
        if asset.asset_type == "model" and asset.related_job_id == job.job_id
    ]

    assert job.model_job.status == JobStatus.failed
    assert [model.model_variant for model in models] == ["geometry"]
