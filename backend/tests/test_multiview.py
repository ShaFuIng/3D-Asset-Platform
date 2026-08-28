import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from app.errors import ApiError
from app.schemas import JobStatus
from app.services.multiview_jobs import (
    run_multiview_image_job,
    run_multiview_image_job_openai,
    run_multiview_model_job,
    run_multiview_view_openai_edit_job,
    run_multiview_view_regeneration_job,
    run_multiview_view_regeneration_job_openai,
)
from app.services.multiview_workflows import HunyuanMultiviewWorkflow, QwenMultiviewWorkflow
from tests.conftest import FakeBlenderClient, FakeComfyClient, FakeOpenAIClient, GLB_BYTES, PNG_BYTES


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


def test_create_multiview_job_openai_provider_skips_comfy_preflight(
    client: TestClient, image_id: str
) -> None:
    # No prepare_multiview_app(): the Qwen/Hunyuan workflow templates are
    # never written to disk, and ComfyUI is reported unavailable. The
    # "openai" provider must still succeed, proving the endpoint never
    # touches comfy_client.ensure_available() or the Qwen workflow adapter
    # for this provider.
    client.app.state.comfy_client = FakeComfyClient(available=False)

    response = client.post(
        "/api/multiview/jobs",
        json={"reference_image_id": image_id, "provider": "openai"},
    )

    assert response.status_code == 202
    data = response.json()
    assert data["provider"] == "openai"


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


def _prepare_multiview_model_job(client: TestClient, image_id: str) -> str:
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

    return asyncio.run(prepare())


def test_multiview_model_usdz_converts_once_per_kind_and_caches(
    client: TestClient, image_id: str
) -> None:
    job_id = _prepare_multiview_model_job(client, image_id)
    blender = client.app.state.blender_client
    assert isinstance(blender, FakeBlenderClient)

    geometry_first = client.get(f"/api/multiview/jobs/{job_id}/models/geometry/usdz")
    geometry_second = client.get(f"/api/multiview/jobs/{job_id}/models/geometry/usdz")
    textured_first = client.get(f"/api/multiview/jobs/{job_id}/models/textured/usdz")

    assert geometry_first.status_code == 200
    assert geometry_first.headers["content-type"].startswith("model/vnd.usdz+zip")
    assert geometry_second.status_code == 200
    assert geometry_second.content == geometry_first.content
    assert textured_first.status_code == 200
    # geometry converted once (cached on the 2nd hit), textured converted
    # once -- two calls total, not three.
    assert len(blender.calls) == 2


def test_multiview_model_usdz_invalid_kind_returns_400(client: TestClient, image_id: str) -> None:
    job_id = _prepare_multiview_model_job(client, image_id)

    response = client.get(f"/api/multiview/jobs/{job_id}/models/side/usdz")

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_model_kind"


def test_multiview_model_usdz_without_blender_configured_returns_503(
    client: TestClient, image_id: str
) -> None:
    job_id = _prepare_multiview_model_job(client, image_id)
    client.app.state.blender_client = FakeBlenderClient(configured=False)

    response = client.get(f"/api/multiview/jobs/{job_id}/models/geometry/usdz")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "blender_not_configured"


def test_multiview_model_usdz_conversion_failure_returns_502_without_failing_job(
    client: TestClient, image_id: str
) -> None:
    from app.services.blender_client import BlenderClientError

    job_id = _prepare_multiview_model_job(client, image_id)
    client.app.state.blender_client = FakeBlenderClient(
        error=BlenderClientError("Blender GLB to USDZ conversion failed: boom")
    )

    usdz_response = client.get(f"/api/multiview/jobs/{job_id}/models/textured/usdz")
    glb_response = client.get(f"/api/multiview/jobs/{job_id}/models/textured")

    assert usdz_response.status_code == 502
    assert usdz_response.json()["error"]["code"] == "usdz_conversion_failed"
    # A failed USDZ conversion must not affect the GLB download path.
    assert glb_response.status_code == 200
    assert glb_response.content == GLB_BYTES


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


class FakeSingleViewComfy(FakeMultiviewComfy):
    def __init__(self, settings, *, output_count: int = 1) -> None:
        super().__init__(settings)
        self.output_count = output_count
        self.uploaded_paths = []

    async def upload_image(self, image_path):
        self.uploaded_paths.append(image_path)
        return image_path.name

    async def history(self, prompt_id: str):
        return {
            prompt_id: {
                "outputs": {
                    "9": {
                        "images": [
                            image_output(f"candidate-{index}.png")
                            for index in range(self.output_count)
                        ]
                    }
                }
            }
        }


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
        assert len(slot.versions) == 1
        assert slot.versions[0].image.image_id == slot.current_image.image_id
        assert slot.versions[0].strategy == "initial"


def test_run_multiview_image_job_openai_saves_distinct_assets_without_comfy(
    client: TestClient, image_id: str
) -> None:
    # No prepare_multiview_app(): the Qwen/Hunyuan workflow templates are
    # never written, and the FakeComfyClient passed in is unusable (no
    # settings). This is the OpenAI counterpart of
    # test_run_multiview_image_job_saves_distinct_assets, proving the whole
    # image job runs end to end without a single ComfyUI/Qwen call.
    async def run():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "openai")
        await run_multiview_image_job_openai(
            job.job_id,
            reference,
            client.app.state.multiview_job_store,
            client.app.state.openai_client,
            client.app.state.storage,
        )
        return await client.app.state.multiview_job_store.get(job.job_id)

    job = asyncio.run(run())

    assert job.status == JobStatus.succeeded
    assert {slot.current_image.image_id for slot in job.views.values()} != {image_id}
    assert len({slot.current_image.image_id for slot in job.views.values()}) == 3
    for view, slot in job.views.items():
        asset = client.app.state.asset_catalog.get_asset(slot.current_image.image_id)
        assert asset.filename.startswith(f"openai-{view}-")
        assert asset.source == "multiview"
        assert asset.view_name == view
        assert asset.related_job_id == job.job_id
        assert asset.reference_image_id == image_id
        assert len(slot.versions) == 1
        assert slot.versions[0].image.image_id == slot.current_image.image_id
        assert slot.versions[0].strategy == "initial"


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


def test_regenerate_local_reroll_endpoint_queues_one_view(client: TestClient, image_id: str) -> None:
    prepare_multiview_app(client)

    async def prepare():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = {
            view: client.app.state.storage.save_image_bytes(PNG_BYTES, view, ".png")
            for view in ("front", "left", "back")
        }
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        return job.job_id

    job_id = asyncio.run(prepare())
    response = client.post(
        f"/api/multiview/jobs/{job_id}/views/left/regenerate",
        json={"strategy": "local_reroll"},
    )

    assert response.status_code == 202
    data = response.json()
    assert data["views"]["left"]["status"] == "queued"
    assert data["views"]["left"]["current_image"] is not None
    assert data["views"]["left"]["candidate_image"] is None
    assert data["views"]["front"]["status"] == "succeeded"


def test_regenerate_local_reroll_rejects_instruction(client: TestClient, image_id: str) -> None:
    prepare_multiview_app(client)
    created = client.post("/api/multiview/jobs", json={"reference_image_id": image_id}).json()

    response = client.post(
        f"/api/multiview/jobs/{created['job_id']}/views/front/regenerate",
        json={"strategy": "local_reroll", "instruction": "change the sleeve"},
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"


def test_regenerate_openai_edit_endpoint_queues_one_view(client: TestClient, image_id: str) -> None:
    prepare_multiview_app(client)

    async def prepare():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = {
            view: client.app.state.storage.save_image_bytes(PNG_BYTES, view, ".png")
            for view in ("front", "left", "back")
        }
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        return job.job_id

    job_id = asyncio.run(prepare())
    response = client.post(
        f"/api/multiview/jobs/{job_id}/views/front/regenerate",
        json={"strategy": "openai_edit", "instruction": "change the sleeve"},
    )

    assert response.status_code == 202
    assert response.json()["views"]["front"]["status"] == "queued"


@pytest.mark.parametrize("instruction", [None, "", "   "])
def test_regenerate_openai_edit_requires_instruction(
    client: TestClient, image_id: str, instruction
) -> None:
    prepare_multiview_app(client)
    created = client.post("/api/multiview/jobs", json={"reference_image_id": image_id}).json()
    payload = {"strategy": "openai_edit"}
    if instruction is not None:
        payload["instruction"] = instruction

    response = client.post(
        f"/api/multiview/jobs/{created['job_id']}/views/front/regenerate",
        json=payload,
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"


def test_regenerate_openai_edit_accepts_chinese_instruction(client: TestClient, image_id: str) -> None:
    prepare_multiview_app(client)

    async def prepare():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = {
            view: client.app.state.storage.save_image_bytes(PNG_BYTES, view, ".png")
            for view in ("front", "left", "back")
        }
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        return job.job_id

    job_id = asyncio.run(prepare())
    response = client.post(
        f"/api/multiview/jobs/{job_id}/views/left/regenerate",
        json={"strategy": "openai_edit", "instruction": "將左側袖子改成黑色"},
    )

    assert response.status_code == 202


def test_regenerate_openai_reroll_endpoint_queues_one_view_without_comfy(
    client: TestClient, image_id: str
) -> None:
    # No prepare_multiview_app() and an unavailable ComfyClient: openai_reroll
    # must not touch comfy_client or the Qwen workflow adapter.
    client.app.state.comfy_client = FakeComfyClient(available=False)

    async def prepare():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "openai")
        records = {
            view: client.app.state.storage.save_image_bytes(PNG_BYTES, view, ".png")
            for view in ("front", "left", "back")
        }
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        return job.job_id

    job_id = asyncio.run(prepare())
    response = client.post(
        f"/api/multiview/jobs/{job_id}/views/left/regenerate",
        json={"strategy": "openai_reroll"},
    )

    assert response.status_code == 202
    data = response.json()
    assert data["views"]["left"]["status"] == "queued"
    assert data["views"]["left"]["candidate_image"] is None
    assert data["views"]["front"]["status"] == "succeeded"


def test_regenerate_openai_reroll_rejects_instruction(client: TestClient, image_id: str) -> None:
    created = client.post(
        "/api/multiview/jobs", json={"reference_image_id": image_id, "provider": "openai"}
    ).json()

    response = client.post(
        f"/api/multiview/jobs/{created['job_id']}/views/front/regenerate",
        json={"strategy": "openai_reroll", "instruction": "change the sleeve"},
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"


def test_start_view_regeneration_rejects_duplicate_same_view(client: TestClient, image_id: str) -> None:
    async def prepare():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = {
            view: client.app.state.storage.save_image_bytes(PNG_BYTES, view, ".png")
            for view in ("front", "left", "back")
        }
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        await client.app.state.multiview_job_store.start_view_regeneration(
            job.job_id,
            "left",
            "attempt-1",
            "local_reroll",
        )
        with pytest.raises(ApiError) as exc:
            await client.app.state.multiview_job_store.start_view_regeneration(
                job.job_id,
                "left",
                "attempt-2",
                "local_reroll",
            )
        return exc.value

    error = asyncio.run(prepare())
    assert error.code == "view_regeneration_running"


def test_start_view_regeneration_allows_different_views(client: TestClient, image_id: str) -> None:
    async def prepare():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = {
            view: client.app.state.storage.save_image_bytes(PNG_BYTES, view, ".png")
            for view in ("front", "left", "back")
        }
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        await client.app.state.multiview_job_store.start_view_regeneration(
            job.job_id,
            "front",
            "attempt-front",
            "local_reroll",
        )
        return await client.app.state.multiview_job_store.start_view_regeneration(
            job.job_id,
            "left",
            "attempt-left",
            "local_reroll",
        )

    job = asyncio.run(prepare())
    assert job.views["front"].status == JobStatus.queued
    assert job.views["left"].status == JobStatus.queued


def test_run_view_regeneration_uses_reference_and_sets_candidate(client: TestClient, image_id: str) -> None:
    prepare_multiview_app(client)

    async def run():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = {
            view: client.app.state.storage.save_image_bytes(PNG_BYTES, view, ".png")
            for view in ("front", "left", "back")
        }
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        await client.app.state.multiview_job_store.start_view_regeneration(
            job.job_id,
            "left",
            "attempt-1",
            "local_reroll",
        )
        comfy = FakeSingleViewComfy(client.app.state.settings)
        usage_lease = client.app.state.asset_usage_guard.acquire(
            reference.image_id,
            owner="test-regenerate",
            reason="multiview_regenerate_reference_image",
        )
        assert client.app.state.asset_usage_guard.is_in_use(reference.image_id)
        from app.services.multiview_jobs import run_multiview_view_regeneration_job

        await run_multiview_view_regeneration_job(
            job.job_id,
            "left",
            "attempt-1",
            reference,
            client.app.state.multiview_job_store,
            comfy,
            client.app.state.qwen_multiview_workflow,
            client.app.state.storage,
            usage_lease,
        )
        return await client.app.state.multiview_job_store.get(job.job_id), reference, comfy

    job, reference, comfy = asyncio.run(run())
    slot = job.views["left"]
    assert comfy.uploaded_paths == [reference.path]
    assert slot.current_image is not None
    assert slot.candidate_image is not None
    assert slot.candidate_image.image_id != slot.current_image.image_id
    assert not client.app.state.asset_usage_guard.is_in_use(reference.image_id)
    asset = client.app.state.asset_catalog.get_asset(slot.candidate_image.image_id)
    assert asset.source == "multiview"
    assert asset.related_job_id == job.job_id
    assert asset.reference_image_id == image_id
    assert asset.view_name == "left"
    assert comfy.workflows[0]["113"]["inputs"]["text"].startswith("<sks> left side view")
    assert comfy.workflows[0]["112:105"]["inputs"]["seed"] != 1


def test_run_view_regeneration_openai_uses_reference_and_sets_candidate(
    client: TestClient, image_id: str
) -> None:
    # OpenAI counterpart of test_run_view_regeneration_uses_reference_and_sets_candidate:
    # same reference-image source and candidate bookkeeping, but through
    # openai_client.generate_multiview_view instead of Qwen/ComfyUI.
    async def run():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "openai")
        records = {
            view: client.app.state.storage.save_image_bytes(PNG_BYTES, view, ".png")
            for view in ("front", "left", "back")
        }
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        await client.app.state.multiview_job_store.start_view_regeneration(
            job.job_id,
            "left",
            "attempt-1",
            "openai_reroll",
        )
        usage_lease = client.app.state.asset_usage_guard.acquire(
            reference.image_id,
            owner="test-regenerate-openai",
            reason="multiview_regenerate_reference_image",
        )
        assert client.app.state.asset_usage_guard.is_in_use(reference.image_id)

        await run_multiview_view_regeneration_job_openai(
            job.job_id,
            "left",
            "attempt-1",
            reference,
            client.app.state.multiview_job_store,
            client.app.state.openai_client,
            client.app.state.storage,
            usage_lease,
        )
        return await client.app.state.multiview_job_store.get(job.job_id), reference

    job, reference = asyncio.run(run())
    slot = job.views["left"]
    assert slot.current_image is not None
    assert slot.candidate_image is not None
    assert slot.candidate_image.image_id != slot.current_image.image_id
    assert not client.app.state.asset_usage_guard.is_in_use(reference.image_id)
    asset = client.app.state.asset_catalog.get_asset(slot.candidate_image.image_id)
    assert asset.filename.startswith("openai-left-")
    assert asset.source == "multiview"
    assert asset.related_job_id == job.job_id
    assert asset.reference_image_id == image_id
    assert asset.view_name == "left"
    assert slot.versions[-1].strategy == "openai_reroll"


def test_view_regeneration_failure_preserves_current_and_candidate(client: TestClient, image_id: str) -> None:
    prepare_multiview_app(client)

    async def run():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = {
            view: client.app.state.storage.save_image_bytes(PNG_BYTES, view, ".png")
            for view in ("front", "left", "back")
        }
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        previous_candidate = client.app.state.storage.save_image_bytes(PNG_BYTES, "candidate", ".png")
        await client.app.state.multiview_job_store.set_candidate(job.job_id, "left", previous_candidate)
        before = await client.app.state.multiview_job_store.get(job.job_id)
        await client.app.state.multiview_job_store.start_view_regeneration(
            job.job_id,
            "left",
            "attempt-1",
            "local_reroll",
        )
        from app.services.multiview_jobs import run_multiview_view_regeneration_job

        await run_multiview_view_regeneration_job(
            job.job_id,
            "left",
            "attempt-1",
            reference,
            client.app.state.multiview_job_store,
            FakeSingleViewComfy(client.app.state.settings, output_count=2),
            client.app.state.qwen_multiview_workflow,
            client.app.state.storage,
        )
        return before, await client.app.state.multiview_job_store.get(job.job_id)

    before, after = asyncio.run(run())
    assert after.views["left"].status == JobStatus.failed
    assert after.views["left"].current_image == before.views["left"].current_image
    assert after.views["left"].candidate_image == before.views["left"].candidate_image
    assert after.views["left"].error


def test_view_regeneration_attempt_mismatch_does_not_overwrite_candidate(
    client: TestClient, image_id: str
) -> None:
    async def run():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = {
            view: client.app.state.storage.save_image_bytes(PNG_BYTES, view, ".png")
            for view in ("front", "left", "back")
        }
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        await client.app.state.multiview_job_store.start_view_regeneration(
            job.job_id,
            "left",
            "attempt-1",
            "local_reroll",
        )
        image = client.app.state.storage.save_image_bytes(PNG_BYTES, "candidate", ".png")
        await client.app.state.multiview_job_store.set_view_regeneration_candidate(
            job.job_id,
            "left",
            "attempt-old",
            image,
        )
        return await client.app.state.multiview_job_store.get(job.job_id)

    job = asyncio.run(run())
    assert job.views["left"].candidate_image is None
    assert job.views["left"].regeneration_attempt_id == "attempt-1"
    assert [version.strategy for version in job.views["left"].versions] == ["initial"]


def test_openai_edit_regeneration_uses_current_image_and_sets_candidate(
    client: TestClient, image_id: str
) -> None:
    async def run():
        reference = client.app.state.storage.get_image_by_id(image_id)
        reference.path.write_bytes(b"reference-bytes")
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = {
            view: client.app.state.storage.save_image_bytes(PNG_BYTES, view, ".png")
            for view in ("front", "left", "back")
        }
        records["left"].path.write_bytes(b"current-left-bytes")
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        candidate = client.app.state.storage.save_image_bytes(PNG_BYTES, "candidate", ".png")
        candidate.path.write_bytes(b"candidate-bytes")
        await client.app.state.multiview_job_store.set_candidate(job.job_id, "left", candidate)
        await client.app.state.multiview_job_store.start_view_regeneration(
            job.job_id,
            "left",
            "attempt-1",
            "openai_edit",
        )
        usage_lease = client.app.state.asset_usage_guard.acquire(
            records["left"].image_id,
            owner="test-openai-edit",
            reason="multiview_regenerate_current_image",
        )
        assert client.app.state.asset_usage_guard.is_in_use(records["left"].image_id)
        openai = FakeOpenAIClient()
        from app.services.multiview_jobs import run_multiview_view_openai_edit_job

        await run_multiview_view_openai_edit_job(
            job.job_id,
            "left",
            "attempt-1",
            records["left"],
            reference.image_id,
            "將左側袖子改成黑色",
            client.app.state.multiview_job_store,
            openai,
            client.app.state.storage,
            usage_lease,
        )
        return await client.app.state.multiview_job_store.get(job.job_id), openai, records, candidate

    job, openai, records, previous_candidate = asyncio.run(run())
    slot = job.views["left"]
    assert openai.edit_calls[0]["source_bytes"] == b"current-left-bytes"
    assert openai.edit_calls[0]["source_bytes"] != b"reference-bytes"
    assert openai.edit_calls[0]["source_bytes"] != b"candidate-bytes"
    assert slot.current_image.image_id == records["left"].image_id
    assert slot.candidate_image.image_id != previous_candidate.image_id
    assert slot.candidate_image.image_id != slot.current_image.image_id
    assert not client.app.state.asset_usage_guard.is_in_use(records["left"].image_id)
    asset = client.app.state.asset_catalog.get_asset(slot.candidate_image.image_id)
    assert asset.source == "multiview"
    assert asset.related_job_id == job.job_id
    assert asset.reference_image_id == image_id
    assert asset.view_name == "left"


def test_openai_edit_failure_preserves_current_and_existing_candidate(
    client: TestClient, image_id: str
) -> None:
    async def run():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = {
            view: client.app.state.storage.save_image_bytes(PNG_BYTES, view, ".png")
            for view in ("front", "left", "back")
        }
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        candidate = client.app.state.storage.save_image_bytes(PNG_BYTES, "candidate", ".png")
        await client.app.state.multiview_job_store.set_candidate(job.job_id, "left", candidate)
        before = await client.app.state.multiview_job_store.get(job.job_id)
        await client.app.state.multiview_job_store.start_view_regeneration(
            job.job_id,
            "left",
            "attempt-1",
            "openai_edit",
        )
        from app.services.multiview_jobs import run_multiview_view_openai_edit_job

        await run_multiview_view_openai_edit_job(
            job.job_id,
            "left",
            "attempt-1",
            records["left"],
            reference.image_id,
            "change sleeve",
            client.app.state.multiview_job_store,
            FakeOpenAIClient(error=ApiError(502, "openai_request_failed", "OpenAI image edit failed.")),
            client.app.state.storage,
        )
        return before, await client.app.state.multiview_job_store.get(job.job_id)

    before, after = asyncio.run(run())
    assert after.views["left"].status == JobStatus.failed
    assert after.views["left"].error == "OpenAI image edit failed."
    assert after.views["left"].current_image == before.views["left"].current_image
    assert after.views["left"].candidate_image == before.views["left"].candidate_image


def test_openai_edit_attempt_mismatch_does_not_overwrite_candidate(
    client: TestClient, image_id: str
) -> None:
    async def run():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = {
            view: client.app.state.storage.save_image_bytes(PNG_BYTES, view, ".png")
            for view in ("front", "left", "back")
        }
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        await client.app.state.multiview_job_store.start_view_regeneration(
            job.job_id,
            "left",
            "attempt-current",
            "openai_edit",
        )
        from app.services.multiview_jobs import run_multiview_view_openai_edit_job

        await run_multiview_view_openai_edit_job(
            job.job_id,
            "left",
            "attempt-old",
            records["left"],
            reference.image_id,
            "change sleeve",
            client.app.state.multiview_job_store,
            FakeOpenAIClient(),
            client.app.state.storage,
        )
        return await client.app.state.multiview_job_store.get(job.job_id)

    job = asyncio.run(run())
    assert job.views["left"].candidate_image is None
    assert job.views["left"].regeneration_attempt_id == "attempt-current"
    assert [version.strategy for version in job.views["left"].versions] == ["initial"]


def test_view_versions_keep_initial_local_and_openai_order(client: TestClient, image_id: str) -> None:
    prepare_multiview_app(client)

    async def run():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = _save_multiview_records(client, job.job_id, image_id)
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        await client.app.state.multiview_job_store.start_view_regeneration(
            job.job_id,
            "left",
            "attempt-local",
            "local_reroll",
        )
        await run_multiview_view_regeneration_job(
            job.job_id,
            "left",
            "attempt-local",
            reference,
            client.app.state.multiview_job_store,
            FakeSingleViewComfy(client.app.state.settings),
            client.app.state.qwen_multiview_workflow,
            client.app.state.storage,
        )
        after_local = await client.app.state.multiview_job_store.get(job.job_id)
        await client.app.state.multiview_job_store.start_view_regeneration(
            job.job_id,
            "left",
            "attempt-openai",
            "openai_edit",
        )
        await run_multiview_view_openai_edit_job(
            job.job_id,
            "left",
            "attempt-openai",
            records["left"],
            reference.image_id,
            "change sleeve",
            client.app.state.multiview_job_store,
            FakeOpenAIClient(),
            client.app.state.storage,
        )
        return after_local, await client.app.state.multiview_job_store.get(job.job_id)

    after_local, job = asyncio.run(run())
    slot = job.views["left"]

    assert [version.strategy for version in slot.versions] == ["initial", "local_reroll", "openai_edit"]
    assert len({version.image.image_id for version in slot.versions}) == 3
    assert slot.candidate_image.image_id == slot.versions[-1].image.image_id
    assert after_local.views["left"].candidate_image.image_id == slot.versions[1].image.image_id


def test_accept_candidate_keeps_old_and_new_versions(client: TestClient, image_id: str) -> None:
    async def run():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = _save_multiview_records(client, job.job_id, image_id)
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        candidate = _save_multiview_image(client, job.job_id, image_id, "left", "candidate")
        await client.app.state.multiview_job_store.set_candidate(job.job_id, "left", candidate)
        await client.app.state.multiview_job_store.accept_view(job.job_id, "left")
        return await client.app.state.multiview_job_store.get(job.job_id), records["left"], candidate

    job, original, candidate = asyncio.run(run())
    slot = job.views["left"]

    assert slot.current_image.image_id == candidate.image_id
    assert slot.candidate_image is None
    assert [version.image.image_id for version in slot.versions] == [original.image_id, candidate.image_id]


def test_duplicate_version_image_id_is_not_appended(client: TestClient, image_id: str) -> None:
    async def run():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = _save_multiview_records(client, job.job_id, image_id)
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        await client.app.state.multiview_job_store.set_candidate(job.job_id, "left", records["left"])
        return await client.app.state.multiview_job_store.get(job.job_id)

    job = asyncio.run(run())

    assert [version.image.image_id for version in job.views["left"].versions] == [
        job.views["left"].current_image.image_id
    ]


def test_failed_regeneration_does_not_append_version(client: TestClient, image_id: str) -> None:
    prepare_multiview_app(client)

    async def run():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = _save_multiview_records(client, job.job_id, image_id)
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        await client.app.state.multiview_job_store.start_view_regeneration(
            job.job_id,
            "left",
            "attempt-1",
            "local_reroll",
        )
        await run_multiview_view_regeneration_job(
            job.job_id,
            "left",
            "attempt-1",
            reference,
            client.app.state.multiview_job_store,
            FakeSingleViewComfy(client.app.state.settings, output_count=2),
            client.app.state.qwen_multiview_workflow,
            client.app.state.storage,
        )
        return await client.app.state.multiview_job_store.get(job.job_id)

    job = asyncio.run(run())

    assert job.views["left"].status == JobStatus.failed
    assert [version.strategy for version in job.views["left"].versions] == ["initial"]


def test_multiview_response_marks_version_current_candidate_and_availability(
    client: TestClient, image_id: str
) -> None:
    async def prepare():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = _save_multiview_records(client, job.job_id, image_id)
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        trashed = _save_multiview_image(client, job.job_id, image_id, "left", "trash")
        missing = _save_multiview_image(client, job.job_id, image_id, "left", "missing")
        await client.app.state.multiview_job_store.set_candidate(job.job_id, "left", trashed)
        await client.app.state.multiview_job_store.set_candidate(job.job_id, "left", missing)
        client.app.state.asset_catalog.trash_asset(trashed.image_id)
        missing_asset = client.app.state.asset_catalog.get_asset(missing.image_id)
        client.app.state.asset_catalog.resolve_relative_path(missing_asset.relative_path).unlink()
        client.app.state.asset_catalog.mark_missing(missing.image_id)
        return job.job_id, records["left"], trashed, missing

    job_id, current, trashed, missing = asyncio.run(prepare())

    response = client.get(f"/api/multiview/jobs/{job_id}")

    assert response.status_code == 200
    versions = response.json()["views"]["left"]["versions"]
    by_id = {version["image"]["image_id"]: version for version in versions}
    assert by_id[current.image_id]["is_current"] is True
    assert by_id[current.image_id]["available"] is True
    assert by_id[current.image_id]["state"] == "active"
    assert by_id[trashed.image_id]["available"] is False
    assert by_id[trashed.image_id]["state"] == "trash"
    assert by_id[missing.image_id]["is_candidate"] is True
    assert by_id[missing.image_id]["available"] is False
    assert by_id[missing.image_id]["state"] == "missing"


def test_set_candidate_endpoint_uses_history_version(client: TestClient, image_id: str) -> None:
    async def prepare():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = _save_multiview_records(client, job.job_id, image_id)
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        candidate = _save_multiview_image(client, job.job_id, image_id, "left", "candidate")
        await client.app.state.multiview_job_store.set_candidate(job.job_id, "left", candidate)
        current = records["left"]
        await client.app.state.multiview_job_store.accept_view(job.job_id, "left")
        return job.job_id, current, candidate

    job_id, old_current, accepted = asyncio.run(prepare())

    response = client.post(
        f"/api/multiview/jobs/{job_id}/views/left/candidate",
        json={"image_id": old_current.image_id},
    )

    assert response.status_code == 200
    data = response.json()["views"]["left"]
    assert data["current_image"]["image_id"] == accepted.image_id
    assert data["candidate_image"]["image_id"] == old_current.image_id


def test_set_candidate_endpoint_current_image_clears_candidate(
    client: TestClient, image_id: str
) -> None:
    async def prepare():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = _save_multiview_records(client, job.job_id, image_id)
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        candidate = _save_multiview_image(client, job.job_id, image_id, "left", "candidate")
        await client.app.state.multiview_job_store.set_candidate(job.job_id, "left", candidate)
        return job.job_id, records["left"]

    job_id, current = asyncio.run(prepare())

    response = client.post(
        f"/api/multiview/jobs/{job_id}/views/left/candidate",
        json={"image_id": current.image_id},
    )

    assert response.status_code == 200
    data = response.json()["views"]["left"]
    assert data["current_image"]["image_id"] == current.image_id
    assert data["candidate_image"] is None


def test_set_candidate_endpoint_rejects_other_job_or_view_and_non_version(
    client: TestClient, image_id: str
) -> None:
    async def prepare():
        reference = client.app.state.storage.get_image_by_id(image_id)
        first = await client.app.state.multiview_job_store.create(reference, "local")
        second = await client.app.state.multiview_job_store.create(reference, "local")
        first_records = _save_multiview_records(client, first.job_id, image_id)
        second_records = _save_multiview_records(client, second.job_id, image_id)
        await client.app.state.multiview_job_store.set_images_succeeded(first.job_id, first_records)
        await client.app.state.multiview_job_store.set_images_succeeded(second.job_id, second_records)
        non_version = _save_multiview_image(client, first.job_id, image_id, "left", "extra")
        return first.job_id, first_records["front"], second_records["left"], non_version

    job_id, other_view, other_job, non_version = asyncio.run(prepare())

    for image in (other_view, other_job, non_version):
        response = client.post(
            f"/api/multiview/jobs/{job_id}/views/left/candidate",
            json={"image_id": image.image_id},
        )
        assert response.status_code == 400


def test_set_candidate_endpoint_rejects_trash_missing_and_running(
    client: TestClient, image_id: str
) -> None:
    async def prepare():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = _save_multiview_records(client, job.job_id, image_id)
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        trashed = _save_multiview_image(client, job.job_id, image_id, "left", "trash")
        missing = _save_multiview_image(client, job.job_id, image_id, "left", "missing")
        await client.app.state.multiview_job_store.set_candidate(job.job_id, "left", trashed)
        await client.app.state.multiview_job_store.set_candidate(job.job_id, "left", missing)
        client.app.state.asset_catalog.trash_asset(trashed.image_id)
        missing_asset = client.app.state.asset_catalog.get_asset(missing.image_id)
        client.app.state.asset_catalog.resolve_relative_path(missing_asset.relative_path).unlink()
        client.app.state.asset_catalog.mark_missing(missing.image_id)
        return job.job_id, records["left"], trashed, missing

    job_id, current, trashed, missing = asyncio.run(prepare())

    trash_response = client.post(
        f"/api/multiview/jobs/{job_id}/views/left/candidate",
        json={"image_id": trashed.image_id},
    )
    missing_response = client.post(
        f"/api/multiview/jobs/{job_id}/views/left/candidate",
        json={"image_id": missing.image_id},
    )
    asyncio.run(
        client.app.state.multiview_job_store.start_view_regeneration(
            job_id,
            "left",
            "attempt-running",
            "local_reroll",
        )
    )
    running_response = client.post(
        f"/api/multiview/jobs/{job_id}/views/left/candidate",
        json={"image_id": current.image_id},
    )

    assert trash_response.status_code == 409
    assert missing_response.status_code == 409
    assert running_response.status_code == 409
    assert running_response.json()["error"]["code"] == "view_regeneration_running"


def test_set_candidate_endpoint_does_not_create_files_or_catalog_rows(
    client: TestClient, image_id: str
) -> None:
    async def prepare():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = _save_multiview_records(client, job.job_id, image_id)
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        candidate = _save_multiview_image(client, job.job_id, image_id, "left", "candidate")
        await client.app.state.multiview_job_store.set_candidate(job.job_id, "left", candidate)
        return job.job_id, candidate

    job_id, candidate = asyncio.run(prepare())
    before_count = client.app.state.asset_catalog.count_assets()
    before_files = sorted(path.name for path in client.app.state.storage.images_dir.iterdir())

    response = client.post(
        f"/api/multiview/jobs/{job_id}/views/left/candidate",
        json={"image_id": candidate.image_id},
    )

    after_files = sorted(path.name for path in client.app.state.storage.images_dir.iterdir())
    assert response.status_code == 200
    assert client.app.state.asset_catalog.count_assets() == before_count
    assert after_files == before_files


def _save_multiview_records(client: TestClient, job_id: str, reference_image_id: str):
    return {
        view: _save_multiview_image(client, job_id, reference_image_id, view, view)
        for view in ("front", "left", "back")
    }


def _save_multiview_image(
    client: TestClient,
    job_id: str,
    reference_image_id: str,
    view: str,
    prefix: str,
):
    return client.app.state.storage.save_image_bytes(
        PNG_BYTES,
        prefix,
        ".png",
        source="multiview",
        related_job_id=job_id,
        reference_image_id=reference_image_id,
        view_name=view,
    )
