import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.asset_catalog import AssetRecord
from app.asset_usage import AssetUsageGuard
from tests.conftest import GLB_BYTES, PNG_BYTES


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
