import asyncio
import uuid
from pathlib import Path

import pytest
import trimesh
from fastapi.testclient import TestClient

from app.asset_catalog import AssetRecord
from app.asset_usage import AssetUsageGuard
from app.services.blender_client import BlenderClientError
from tests.conftest import FakeBlenderClient, GLB_BYTES, PNG_BYTES, USDZ_BYTES


def test_list_filters_sort_pagination_and_total(client: TestClient) -> None:
    uploaded = _upload(client, "asset.png")
    generated = client.app.state.storage.save_generated_image(PNG_BYTES)
    model_path = client.app.state.storage.models_dir / "model.glb"
    model_path.write_bytes(GLB_BYTES)
    client.app.state.storage.register_model_file(
        model_path,
        source="generated",
        pipeline="single",
        model_variant="single",
        related_job_id="job-1",
        reference_image_id=uploaded["image_id"],
    )
    client.app.state.asset_catalog.trash_asset(generated.image_id)

    active = client.get("/api/library/assets").json()
    assert active["total"] == 2
    assert all(item["deleted_at"] is None for item in active["items"])

    trash = client.get("/api/library/assets?state=trash").json()
    assert trash["total"] == 1
    assert trash["items"][0]["asset_id"] == generated.image_id

    images = client.get("/api/library/assets?type=image").json()
    assert images["total"] == 1

    models = client.get("/api/library/assets?type=model&pipeline=single").json()
    assert models["total"] == 1
    assert models["items"][0]["model_variant"] == "single"

    searched = client.get("/api/library/assets?search=asset").json()
    assert searched["total"] == 1

    paged = client.get("/api/library/assets?sort=filename_asc&page=1&page_size=1").json()
    assert paged["page"] == 1
    assert paged["page_size"] == 1
    assert paged["total"] == 2
    assert len(paged["items"]) == 1


@pytest.mark.parametrize("query", ["page=0", "page_size=0", "page_size=101", "sort=bad"])
def test_list_query_validation(client: TestClient, query: str) -> None:
    response = client.get(f"/api/library/assets?{query}")

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"


def test_detail_and_content_for_image_and_model(client: TestClient) -> None:
    upload = _upload(client, "asset.png")
    model_path = client.app.state.storage.models_dir / "model.glb"
    model_path.write_bytes(GLB_BYTES)
    model = client.app.state.storage.register_model_file(
        model_path,
        source="generated",
        pipeline="single",
        model_variant="single",
        related_job_id="job-1",
        reference_image_id=upload["image_id"],
    )

    detail = client.get(f"/api/library/assets/{upload['image_id']}")
    assert detail.status_code == 200
    assert detail.json()["content_url"] == f"/api/library/assets/{upload['image_id']}/content"

    image_content = client.get(f"/api/library/assets/{upload['image_id']}/content")
    assert image_content.status_code == 200
    assert image_content.headers["content-type"].startswith("image/png")

    model_content = client.get(f"/api/library/assets/{model.asset_id}/content")
    assert model_content.status_code == 200
    assert model_content.headers["content-type"].startswith("model/gltf-binary")


def _register_model_asset(client: TestClient, upload: dict) -> AssetRecord:
    model_path = client.app.state.storage.models_dir / f"{uuid.uuid4()}.glb"
    model_path.write_bytes(GLB_BYTES)
    return client.app.state.storage.register_model_file(
        model_path,
        source="generated",
        pipeline="single",
        model_variant="single",
        related_job_id="job-1",
        reference_image_id=upload["image_id"],
    )


def test_model_asset_usdz_converts_once_and_caches(client: TestClient) -> None:
    upload = _upload(client, "asset.png")
    model = _register_model_asset(client, upload)
    blender = client.app.state.blender_client
    assert isinstance(blender, FakeBlenderClient)

    first = client.get(f"/api/library/assets/{model.asset_id}/usdz")
    second = client.get(f"/api/library/assets/{model.asset_id}/usdz")

    assert first.status_code == 200
    assert first.headers["content-type"].startswith("model/vnd.usdz+zip")
    assert first.content == USDZ_BYTES
    assert second.status_code == 200
    assert second.content == USDZ_BYTES
    assert len(blender.calls) == 1


def test_image_asset_usdz_returns_400(client: TestClient) -> None:
    upload = _upload(client, "asset.png")

    response = client.get(f"/api/library/assets/{upload['image_id']}/usdz")

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_asset_type"


def test_model_asset_usdz_without_blender_configured_returns_503(client: TestClient) -> None:
    upload = _upload(client, "asset.png")
    model = _register_model_asset(client, upload)
    client.app.state.blender_client = FakeBlenderClient(configured=False)

    response = client.get(f"/api/library/assets/{model.asset_id}/usdz")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "blender_not_configured"


def test_model_asset_usdz_conversion_failure_returns_502_without_affecting_content(
    client: TestClient,
) -> None:
    upload = _upload(client, "asset.png")
    model = _register_model_asset(client, upload)
    client.app.state.blender_client = FakeBlenderClient(
        error=BlenderClientError("Blender GLB to USDZ conversion failed: boom")
    )

    usdz_response = client.get(f"/api/library/assets/{model.asset_id}/usdz")
    content_response = client.get(f"/api/library/assets/{model.asset_id}/content")

    assert usdz_response.status_code == 502
    assert usdz_response.json()["error"]["code"] == "usdz_conversion_failed"
    # A failed USDZ conversion must not affect the GLB content endpoint.
    assert content_response.status_code == 200
    assert content_response.content == GLB_BYTES


def test_trash_content_is_still_readable_and_missing_content_returns_409(client: TestClient) -> None:
    upload = _upload(client, "asset.png")
    client.post(f"/api/library/assets/{upload['image_id']}/trash")

    trashed_content = client.get(f"/api/library/assets/{upload['image_id']}/content")
    assert trashed_content.status_code == 200

    asset = client.app.state.asset_catalog.get_asset(upload["image_id"])
    path = client.app.state.asset_catalog.resolve_relative_path(asset.relative_path)
    path.unlink()
    client.app.state.asset_catalog.mark_missing(upload["image_id"])

    missing = client.get(f"/api/library/assets/{upload['image_id']}/content")
    assert missing.status_code == 409
    assert missing.json()["error"]["code"] == "asset_missing"


def test_unsafe_catalog_path_is_rejected(client: TestClient) -> None:
    asset_id = str(uuid.uuid4())
    _insert_raw_asset(client, asset_id, "../secret.png")

    response = client.get(f"/api/library/assets/{asset_id}/content")

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_path"


def test_asset_not_found_returns_404(client: TestClient) -> None:
    response = client.get("/api/library/assets/missing")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "asset_not_found"


def test_trash_is_idempotent_and_does_not_delete_file(client: TestClient) -> None:
    upload = _upload(client, "asset.png")
    asset = client.app.state.asset_catalog.get_asset(upload["image_id"])
    path = client.app.state.asset_catalog.resolve_relative_path(asset.relative_path)

    first = client.post(f"/api/library/assets/{upload['image_id']}/trash")
    second = client.post(f"/api/library/assets/{upload['image_id']}/trash")

    assert first.status_code == 200
    assert second.status_code == 200
    assert path.exists()
    assert first.json()["deleted_at"] == second.json()["deleted_at"]


def test_restore_is_idempotent_and_missing_restore_fails(client: TestClient) -> None:
    upload = _upload(client, "asset.png")
    client.post(f"/api/library/assets/{upload['image_id']}/trash")

    first = client.post(f"/api/library/assets/{upload['image_id']}/restore")
    second = client.post(f"/api/library/assets/{upload['image_id']}/restore")

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["deleted_at"] is None

    asset = client.app.state.asset_catalog.get_asset(upload["image_id"])
    client.app.state.asset_catalog.resolve_relative_path(asset.relative_path).unlink()
    client.app.state.asset_catalog.mark_missing(upload["image_id"])

    missing = client.post(f"/api/library/assets/{upload['image_id']}/restore")
    assert missing.status_code == 409
    assert missing.json()["error"]["code"] == "asset_missing"


def test_active_asset_cannot_be_permanently_deleted(client: TestClient) -> None:
    upload = _upload(client, "asset.png")

    response = client.delete(f"/api/library/assets/{upload['image_id']}")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "asset_not_in_trash"


def test_trash_asset_permanent_delete_removes_file_and_record(client: TestClient) -> None:
    upload = _upload(client, "asset.png")
    asset = client.app.state.asset_catalog.get_asset(upload["image_id"])
    path = client.app.state.asset_catalog.resolve_relative_path(asset.relative_path)
    client.post(f"/api/library/assets/{upload['image_id']}/trash")

    response = client.delete(f"/api/library/assets/{upload['image_id']}")

    assert response.status_code == 200
    assert response.json()["deleted_asset_id"] == upload["image_id"]
    assert not path.exists()
    assert client.app.state.asset_catalog.get_asset(upload["image_id"]) is None


def test_missing_trash_asset_can_cleanup_catalog_record(client: TestClient) -> None:
    upload = _upload(client, "asset.png")
    asset = client.app.state.asset_catalog.get_asset(upload["image_id"])
    path = client.app.state.asset_catalog.resolve_relative_path(asset.relative_path)
    client.post(f"/api/library/assets/{upload['image_id']}/trash")
    path.unlink()
    client.app.state.asset_catalog.mark_missing(upload["image_id"])

    response = client.delete(f"/api/library/assets/{upload['image_id']}")

    assert response.status_code == 200
    assert client.app.state.asset_catalog.get_asset(upload["image_id"]) is None


def test_parent_with_active_or_trash_child_cannot_be_deleted(client: TestClient) -> None:
    parent = _upload(client, "parent.png")
    child = client.app.state.storage.save_edited_image(PNG_BYTES, parent["image_id"])
    client.post(f"/api/library/assets/{child.image_id}/trash")
    client.post(f"/api/library/assets/{parent['image_id']}/trash")

    response = client.delete(f"/api/library/assets/{parent['image_id']}")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "asset_in_use"
    assert response.json()["error"]["details"]["dependents"][0]["asset_id"] == child.image_id


def test_parent_with_model_reference_cannot_be_deleted(client: TestClient) -> None:
    upload = _upload(client, "asset.png")
    model_path = client.app.state.storage.models_dir / "model.glb"
    model_path.write_bytes(GLB_BYTES)
    client.app.state.storage.register_model_file(
        model_path,
        source="generated",
        pipeline="single",
        model_variant="single",
        related_job_id="job-1",
        reference_image_id=upload["image_id"],
    )
    client.post(f"/api/library/assets/{upload['image_id']}/trash")

    response = client.delete(f"/api/library/assets/{upload['image_id']}")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "asset_in_use"


def test_model_delete_does_not_delete_reference_or_other_variant(client: TestClient) -> None:
    upload = _upload(client, "asset.png")
    geometry_path = client.app.state.storage.models_dir / "geometry.glb"
    textured_path = client.app.state.storage.models_dir / "textured.glb"
    geometry_path.write_bytes(GLB_BYTES)
    textured_path.write_bytes(GLB_BYTES)
    geometry = client.app.state.storage.register_model_file(
        geometry_path,
        source="generated",
        pipeline="multiview",
        model_variant="geometry",
        related_job_id="job-1",
        reference_image_id=upload["image_id"],
    )
    textured = client.app.state.storage.register_model_file(
        textured_path,
        source="generated",
        pipeline="multiview",
        model_variant="textured",
        related_job_id="job-1",
        reference_image_id=upload["image_id"],
    )
    client.post(f"/api/library/assets/{geometry.asset_id}/trash")

    response = client.delete(f"/api/library/assets/{geometry.asset_id}")

    assert response.status_code == 200
    assert client.app.state.asset_catalog.get_asset(upload["image_id"]) is not None
    assert client.app.state.asset_catalog.get_asset(textured.asset_id) is not None
    assert textured_path.exists()


def _register_calibrated_child(client: TestClient, parent_asset_id: str, filename: str) -> AssetRecord:
    # Phase 3/4's baking service doesn't exist yet -- this simulates its
    # end result (a second model asset whose parent_asset_id points back at
    # the raw GLB it was calibrated from) directly via upsert_asset(),
    # exactly like register_model_file() does internally.
    catalog = client.app.state.asset_catalog
    path = client.app.state.storage.models_dir / filename
    path.write_bytes(GLB_BYTES)
    return catalog.upsert_asset(
        AssetRecord(
            asset_id=str(uuid.uuid4()),
            asset_type="model",
            filename=filename,
            relative_path=catalog.relative_path_for(path),
            media_type="model/gltf-binary",
            source="calibrated",
            created_at="2026-01-01T00:00:00+00:00",
            deleted_at=None,
            size_bytes=len(GLB_BYTES),
            status="available",
            parent_asset_id=parent_asset_id,
        )
    )


def test_model_with_calibrated_child_cannot_be_deleted(client: TestClient) -> None:
    upload = _upload(client, "asset.png")
    raw_path = client.app.state.storage.models_dir / "raw.glb"
    raw_path.write_bytes(GLB_BYTES)
    raw = client.app.state.storage.register_model_file(
        raw_path,
        source="generated",
        pipeline="single",
        model_variant="single",
        related_job_id="job-1",
        reference_image_id=upload["image_id"],
    )
    calibrated = _register_calibrated_child(client, raw.asset_id, "calibrated.glb")
    client.post(f"/api/library/assets/{raw.asset_id}/trash")

    response = client.delete(f"/api/library/assets/{raw.asset_id}")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "asset_in_use"
    assert response.json()["error"]["details"]["dependents"][0]["asset_id"] == calibrated.asset_id


def test_model_without_calibrated_child_can_be_deleted(client: TestClient) -> None:
    upload = _upload(client, "asset.png")
    model_path = client.app.state.storage.models_dir / "no-child.glb"
    model_path.write_bytes(GLB_BYTES)
    model = client.app.state.storage.register_model_file(
        model_path,
        source="generated",
        pipeline="single",
        model_variant="single",
        related_job_id="job-1",
        reference_image_id=upload["image_id"],
    )
    client.post(f"/api/library/assets/{model.asset_id}/trash")

    response = client.delete(f"/api/library/assets/{model.asset_id}")

    assert response.status_code == 200
    assert client.app.state.asset_catalog.get_asset(model.asset_id) is None


def test_calibrated_child_itself_can_be_deleted(client: TestClient) -> None:
    upload = _upload(client, "asset.png")
    raw_path = client.app.state.storage.models_dir / "raw2.glb"
    raw_path.write_bytes(GLB_BYTES)
    raw = client.app.state.storage.register_model_file(
        raw_path,
        source="generated",
        pipeline="single",
        model_variant="single",
        related_job_id="job-1",
        reference_image_id=upload["image_id"],
    )
    calibrated = _register_calibrated_child(client, raw.asset_id, "calibrated2.glb")
    client.post(f"/api/library/assets/{calibrated.asset_id}/trash")

    response = client.delete(f"/api/library/assets/{calibrated.asset_id}")

    assert response.status_code == 200
    assert client.app.state.asset_catalog.get_asset(calibrated.asset_id) is None
    # Deleting the calibrated child must never cascade back onto its raw
    # source -- the dependency direction only blocks parent -> child.
    assert client.app.state.asset_catalog.get_asset(raw.asset_id) is not None


def _register_real_model_asset(client: TestClient, upload: dict, filename: str) -> AssetRecord:
    # Unlike _register_model_asset() above (which writes fake GLB_BYTES),
    # the calibrate endpoint actually parses the file with trimesh -- these
    # tests need a real, trimesh-loadable GLB, not just magic bytes.
    path = client.app.state.storage.models_dir / filename
    trimesh.creation.box(extents=[2.0, 1.0, 0.5]).export(path)
    return client.app.state.storage.register_model_file(
        path,
        source="generated",
        pipeline="single",
        model_variant="single",
        related_job_id="job-1",
        reference_image_id=upload["image_id"],
    )


def test_calibrate_endpoint_creates_new_asset_with_parent_asset_id(client: TestClient) -> None:
    upload = _upload(client, "asset.png")
    raw = _register_real_model_asset(client, upload, "raw.glb")

    response = client.post(
        f"/api/library/assets/{raw.asset_id}/calibrate",
        json={"target_max_dimension_cm": 15.0},
    )

    assert response.status_code == 201
    data = response.json()
    assert data["parent_asset_id"] == raw.asset_id
    assert data["asset_id"] != raw.asset_id

    raw_detail = client.get(f"/api/library/assets/{raw.asset_id}").json()
    assert raw_detail["calibrated_asset_ids"] == [data["asset_id"]]


def test_recalibrating_trashes_previous_calibrated_asset(client: TestClient) -> None:
    upload = _upload(client, "asset.png")
    raw = _register_real_model_asset(client, upload, "raw.glb")

    first = client.post(
        f"/api/library/assets/{raw.asset_id}/calibrate",
        json={"target_max_dimension_cm": 10.0},
    ).json()
    second = client.post(
        f"/api/library/assets/{raw.asset_id}/calibrate",
        json={"target_max_dimension_cm": 20.0},
    ).json()

    assert first["asset_id"] != second["asset_id"]
    first_after = client.app.state.asset_catalog.get_asset(first["asset_id"])
    assert first_after.deleted_at is not None  # trashed, not deleted -- recoverable
    second_after = client.app.state.asset_catalog.get_asset(second["asset_id"])
    assert second_after.deleted_at is None

    raw_detail = client.get(f"/api/library/assets/{raw.asset_id}").json()
    assert raw_detail["calibrated_asset_ids"] == [second["asset_id"]]


def test_calibrate_missing_asset_returns_404(client: TestClient) -> None:
    response = client.post(
        "/api/library/assets/missing/calibrate",
        json={"target_max_dimension_cm": 10.0},
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "asset_not_found"


def test_calibrate_non_model_asset_returns_400(client: TestClient) -> None:
    upload = _upload(client, "asset.png")

    response = client.post(
        f"/api/library/assets/{upload['image_id']}/calibrate",
        json={"target_max_dimension_cm": 10.0},
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_asset_type"


def test_calibrate_invalid_target_returns_400(client: TestClient) -> None:
    upload = _upload(client, "asset.png")
    raw = _register_real_model_asset(client, upload, "raw.glb")

    response = client.post(
        f"/api/library/assets/{raw.asset_id}/calibrate",
        json={"target_max_dimension_cm": 0.0},
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_target_dimension"


def test_calibrated_asset_appears_in_library_list_with_parent_asset_id(client: TestClient) -> None:
    upload = _upload(client, "asset.png")
    raw = _register_real_model_asset(client, upload, "raw.glb")
    calibrated = client.post(
        f"/api/library/assets/{raw.asset_id}/calibrate",
        json={"target_max_dimension_cm": 15.0},
    ).json()

    listing = client.get("/api/library/assets?type=model").json()

    items_by_id = {item["asset_id"]: item for item in listing["items"]}
    assert items_by_id[raw.asset_id]["calibrated_asset_ids"] == [calibrated["asset_id"]]
    assert items_by_id[calibrated["asset_id"]]["parent_asset_id"] == raw.asset_id
    assert items_by_id[calibrated["asset_id"]]["calibrated_asset_ids"] == []


def test_permission_error_keeps_db_record(client: TestClient, monkeypatch) -> None:
    upload = _upload(client, "asset.png")
    client.post(f"/api/library/assets/{upload['image_id']}/trash")

    def locked(_path):
        raise PermissionError("locked")

    monkeypatch.setattr(Path, "unlink", locked)
    response = client.delete(f"/api/library/assets/{upload['image_id']}")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "asset_file_locked"
    assert client.app.state.asset_catalog.get_asset(upload["image_id"]) is not None


def test_db_delete_failure_does_not_return_success(client: TestClient, monkeypatch) -> None:
    upload = _upload(client, "asset.png")
    asset = client.app.state.asset_catalog.get_asset(upload["image_id"])
    path = client.app.state.asset_catalog.resolve_relative_path(asset.relative_path)
    client.post(f"/api/library/assets/{upload['image_id']}/trash")

    def fail_delete(_asset_id):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(client.app.state.asset_catalog, "delete_asset_record", fail_delete)
    response = client.delete(f"/api/library/assets/{upload['image_id']}")

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "asset_catalog_failed"
    assert not path.exists()
    assert client.app.state.asset_catalog.get_asset(upload["image_id"]) is not None


def test_in_use_asset_blocks_permanent_delete_but_allows_trash(client: TestClient) -> None:
    upload = _upload(client, "asset.png")
    lease = client.app.state.asset_usage_guard.acquire(
        upload["image_id"],
        owner="test-owner",
        reason="test_reason",
    )
    try:
        trash = client.post(f"/api/library/assets/{upload['image_id']}/trash")
        delete = client.delete(f"/api/library/assets/{upload['image_id']}")
    finally:
        lease.release()

    assert trash.status_code == 200
    assert delete.status_code == 409
    assert delete.json()["error"]["code"] == "asset_in_use"
    assert delete.json()["error"]["details"]["uses"][0]["reason"] == "test_reason"


def test_multiview_current_image_blocks_permanent_delete(client: TestClient, image_id: str) -> None:
    async def prepare():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = _save_multiview_records(client, job.job_id, image_id)
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        return records["left"].image_id

    current_id = asyncio.run(prepare())
    client.post(f"/api/library/assets/{current_id}/trash")

    response = client.delete(f"/api/library/assets/{current_id}")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "asset_in_use"
    assert response.json()["error"]["details"]["references"][0]["role"] == "current"


def test_multiview_candidate_image_blocks_permanent_delete(client: TestClient, image_id: str) -> None:
    async def prepare():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = _save_multiview_records(client, job.job_id, image_id)
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        candidate = _save_multiview_image(client, job.job_id, image_id, "left", "candidate")
        await client.app.state.multiview_job_store.set_candidate(job.job_id, "left", candidate)
        return candidate.image_id

    candidate_id = asyncio.run(prepare())
    client.post(f"/api/library/assets/{candidate_id}/trash")

    response = client.delete(f"/api/library/assets/{candidate_id}")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "asset_in_use"
    assert response.json()["error"]["details"]["references"][0]["role"] == "candidate"


def test_multiview_history_only_version_can_be_deleted_and_pruned(
    client: TestClient, image_id: str
) -> None:
    async def prepare():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = _save_multiview_records(client, job.job_id, image_id)
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        candidate = _save_multiview_image(client, job.job_id, image_id, "left", "candidate")
        await client.app.state.multiview_job_store.set_candidate(job.job_id, "left", candidate)
        await client.app.state.multiview_job_store.accept_view(job.job_id, "left")
        return job.job_id, records["left"].image_id

    job_id, history_id = asyncio.run(prepare())
    client.post(f"/api/library/assets/{history_id}/trash")

    response = client.delete(f"/api/library/assets/{history_id}")
    job = asyncio.run(client.app.state.multiview_job_store.get(job_id))

    assert response.status_code == 200
    assert client.app.state.asset_catalog.get_asset(history_id) is None
    assert history_id not in [version.image.image_id for version in job.views["left"].versions]


def test_multiview_history_only_delete_failure_does_not_prune_versions(
    client: TestClient,
    image_id: str,
    monkeypatch,
) -> None:
    async def prepare():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = _save_multiview_records(client, job.job_id, image_id)
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        candidate = _save_multiview_image(client, job.job_id, image_id, "left", "candidate")
        await client.app.state.multiview_job_store.set_candidate(job.job_id, "left", candidate)
        await client.app.state.multiview_job_store.accept_view(job.job_id, "left")
        return job.job_id, records["left"].image_id

    job_id, history_id = asyncio.run(prepare())
    client.post(f"/api/library/assets/{history_id}/trash")

    def locked(_path):
        raise PermissionError("locked")

    monkeypatch.setattr(Path, "unlink", locked)
    response = client.delete(f"/api/library/assets/{history_id}")
    job = asyncio.run(client.app.state.multiview_job_store.get(job_id))

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "asset_file_locked"
    assert history_id in [version.image.image_id for version in job.views["left"].versions]


def test_multiview_history_only_asset_usage_guard_still_blocks_delete(
    client: TestClient,
    image_id: str,
) -> None:
    async def prepare():
        reference = client.app.state.storage.get_image_by_id(image_id)
        job = await client.app.state.multiview_job_store.create(reference, "local")
        records = _save_multiview_records(client, job.job_id, image_id)
        await client.app.state.multiview_job_store.set_images_succeeded(job.job_id, records)
        candidate = _save_multiview_image(client, job.job_id, image_id, "left", "candidate")
        await client.app.state.multiview_job_store.set_candidate(job.job_id, "left", candidate)
        await client.app.state.multiview_job_store.accept_view(job.job_id, "left")
        return records["left"].image_id

    history_id = asyncio.run(prepare())
    client.post(f"/api/library/assets/{history_id}/trash")
    lease = client.app.state.asset_usage_guard.acquire(
        history_id,
        owner="test-history",
        reason="history_cleanup_test",
    )
    try:
        response = client.delete(f"/api/library/assets/{history_id}")
    finally:
        lease.release()

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "asset_in_use"
    assert response.json()["error"]["details"]["uses"][0]["reason"] == "history_cleanup_test"


def test_different_asset_in_use_does_not_block_delete(client: TestClient) -> None:
    first = _upload(client, "first.png")
    second = _upload(client, "second.png")
    lease = client.app.state.asset_usage_guard.acquire(
        first["image_id"],
        owner="test-owner",
        reason="test_reason",
    )
    try:
        client.post(f"/api/library/assets/{second['image_id']}/trash")
        response = client.delete(f"/api/library/assets/{second['image_id']}")
    finally:
        lease.release()

    assert response.status_code == 200


def test_asset_usage_guard_releases_multiple_assets() -> None:
    guard = AssetUsageGuard()
    lease = guard.acquire_many(["b", "a", "a"], owner="owner", reason="reason")
    assert guard.is_in_use("a")
    assert guard.is_in_use("b")

    lease.release()
    lease.release()

    assert not guard.is_in_use("a")
    assert not guard.is_in_use("b")


def _upload(client: TestClient, filename: str) -> dict:
    response = client.post(
        "/api/images/upload",
        files={"image": (filename, PNG_BYTES, "image/png")},
    )
    assert response.status_code == 201
    return response.json()


def _insert_raw_asset(client: TestClient, asset_id: str, relative_path: str) -> None:
    with client.app.state.asset_catalog._connect() as connection:
        connection.execute(
            """
            INSERT INTO assets (
                asset_id, asset_type, filename, relative_path, media_type, source,
                created_at, deleted_at, size_bytes, status
            )
            VALUES (?, 'image', 'bad.png', ?, 'image/png', 'legacy',
                '2026-01-01T00:00:00+00:00', NULL, 1, 'available')
            """,
            (asset_id, relative_path),
        )


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
