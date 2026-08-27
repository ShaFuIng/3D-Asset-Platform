import os
import sqlite3
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.asset_catalog import AssetCatalog, AssetRecord
from app.errors import ApiError
from app.main import create_app
from app.storage import AssetStorage
from tests.conftest import GLB_BYTES, PNG_BYTES


def test_asset_catalog_initializes_db_and_schema(tmp_path: Path) -> None:
    catalog = AssetCatalog(tmp_path / "storage")

    assert (tmp_path / "storage" / "assets.db").exists()
    assert catalog.list_assets() == []


def test_asset_catalog_migrates_legacy_user_version_one_schema(tmp_path: Path) -> None:
    storage_root = tmp_path / "storage"
    storage_root.mkdir()
    db_path = storage_root / "assets.db"
    with sqlite3.connect(db_path) as connection:
        connection.executescript(
            """
            CREATE TABLE assets (
                asset_id TEXT PRIMARY KEY,
                asset_type TEXT NOT NULL,
                filename TEXT NOT NULL,
                relative_path TEXT NOT NULL UNIQUE,
                media_type TEXT NOT NULL,
                source TEXT NOT NULL,
                created_at TEXT NOT NULL,
                deleted_at TEXT,
                size_bytes INTEGER NOT NULL,
                status TEXT NOT NULL,
                parent_image_id TEXT,
                pipeline TEXT,
                model_variant TEXT,
                related_job_id TEXT,
                reference_image_id TEXT,
                view_name TEXT,
                original_filename TEXT
            );
            CREATE INDEX idx_assets_type_deleted
                ON assets(asset_type, deleted_at);
            CREATE INDEX idx_assets_parent_image_id
                ON assets(parent_image_id);
            CREATE INDEX idx_assets_reference_image_id
                ON assets(reference_image_id);
            CREATE INDEX idx_assets_related_job_id
                ON assets(related_job_id);
            PRAGMA user_version = 1;
            """
        )

    AssetCatalog(storage_root)

    with sqlite3.connect(db_path) as connection:
        columns = {
            row[1]
            for row in connection.execute("PRAGMA table_info(assets)").fetchall()
        }
        indexes = {
            row[1]
            for row in connection.execute("PRAGMA index_list(assets)").fetchall()
        }
        version = connection.execute("PRAGMA user_version").fetchone()[0]

    assert "parent_asset_id" in columns
    assert "idx_assets_parent_asset_id" in indexes
    assert version == 2


def test_empty_storage_reconciliation(tmp_path: Path) -> None:
    catalog, images_dir, models_dir = _catalog_with_dirs(tmp_path)

    catalog.reconcile(images_dir, models_dir)

    assert catalog.list_assets() == []


def test_reconcile_scans_legacy_image(tmp_path: Path) -> None:
    catalog, images_dir, models_dir = _catalog_with_dirs(tmp_path)
    image_path = images_dir / "legacy.png"
    image_path.write_bytes(PNG_BYTES)

    catalog.reconcile(images_dir, models_dir)

    assets = catalog.list_assets()
    assert len(assets) == 1
    assert assets[0].asset_type == "image"
    assert assets[0].source == "legacy"
    assert assets[0].relative_path == "images/legacy.png"
    assert assets[0].media_type == "image/png"
    assert assets[0].status == "available"


def test_reconcile_scans_legacy_glb(tmp_path: Path) -> None:
    catalog, images_dir, models_dir = _catalog_with_dirs(tmp_path)
    model_path = models_dir / "legacy.glb"
    model_path.write_bytes(GLB_BYTES)

    catalog.reconcile(images_dir, models_dir)

    asset = catalog.list_assets()[0]
    assert asset.asset_type == "model"
    assert asset.source == "legacy"
    assert asset.pipeline == "legacy"
    assert asset.model_variant == "unknown"
    assert asset.media_type == "model/gltf-binary"


@pytest.mark.parametrize(
    "filename",
    [
        "upload-{image_id}.png",
        "upload-{image_id}.jpg",
        "upload-{image_id}.jpeg",
        "upload-{image_id}.webp",
        "gpt-{image_id}.png",
        "edit-{image_id}.png",
        "qwen-front-{image_id}.png",
        "qwen-left-{image_id}.png",
        "qwen-back-{image_id}.png",
    ],
)
def test_known_image_filenames_reuse_uuid(tmp_path: Path, filename: str) -> None:
    catalog, images_dir, models_dir = _catalog_with_dirs(tmp_path)
    image_id = str(uuid.uuid4())
    (images_dir / filename.format(image_id=image_id)).write_bytes(PNG_BYTES)

    catalog.reconcile(images_dir, models_dir)

    assert catalog.list_assets()[0].asset_id == image_id


def test_invalid_uuid_filename_uses_new_asset_uuid(tmp_path: Path) -> None:
    catalog, images_dir, models_dir = _catalog_with_dirs(tmp_path)
    (images_dir / "upload-not-a-uuid.png").write_bytes(PNG_BYTES)

    catalog.reconcile(images_dir, models_dir)

    asset = catalog.list_assets()[0]
    assert asset.asset_id != "not-a-uuid"
    uuid.UUID(asset.asset_id)


def test_repeated_reconciliation_does_not_duplicate_records(tmp_path: Path) -> None:
    catalog, images_dir, models_dir = _catalog_with_dirs(tmp_path)
    (images_dir / "legacy.png").write_bytes(PNG_BYTES)

    catalog.reconcile(images_dir, models_dir)
    first_asset = catalog.list_assets()[0]
    catalog.reconcile(images_dir, models_dir)

    assets = catalog.list_assets()
    assert len(assets) == 1
    assert assets[0].asset_id == first_asset.asset_id


def test_relative_path_keeps_asset_id_stable(tmp_path: Path) -> None:
    catalog, images_dir, models_dir = _catalog_with_dirs(tmp_path)
    image_path = images_dir / "legacy.png"
    image_path.write_bytes(PNG_BYTES)
    catalog.reconcile(images_dir, models_dir)
    first_asset_id = catalog.list_assets()[0].asset_id

    catalog = AssetCatalog(tmp_path / "storage")
    catalog.reconcile(images_dir, models_dir)

    assert catalog.list_assets()[0].asset_id == first_asset_id


def test_missing_and_reappeared_file_status(tmp_path: Path) -> None:
    catalog, images_dir, models_dir = _catalog_with_dirs(tmp_path)
    image_path = images_dir / "legacy.png"
    image_path.write_bytes(PNG_BYTES)
    catalog.reconcile(images_dir, models_dir)
    asset_id = catalog.list_assets()[0].asset_id

    image_path.unlink()
    catalog.reconcile(images_dir, models_dir)
    assert catalog.get_asset(asset_id).status == "missing"

    image_path.write_bytes(PNG_BYTES)
    catalog.reconcile(images_dir, models_dir)
    assert catalog.get_asset(asset_id).status == "available"


def test_deleted_at_is_not_cleared_by_reconciliation(tmp_path: Path) -> None:
    catalog, images_dir, models_dir = _catalog_with_dirs(tmp_path)
    (images_dir / "legacy.png").write_bytes(PNG_BYTES)
    catalog.reconcile(images_dir, models_dir)
    asset_id = catalog.list_assets()[0].asset_id

    catalog.mark_deleted(asset_id, "2026-01-01T00:00:00+00:00")
    catalog.reconcile(images_dir, models_dir)

    assert catalog.get_asset(asset_id).deleted_at == "2026-01-01T00:00:00+00:00"


def test_unsupported_files_are_ignored(tmp_path: Path) -> None:
    catalog, images_dir, models_dir = _catalog_with_dirs(tmp_path)
    (images_dir / "notes.txt").write_text("ignore", encoding="utf-8")
    (models_dir / "mesh.obj").write_text("ignore", encoding="utf-8")

    catalog.reconcile(images_dir, models_dir)

    assert catalog.list_assets() == []


@pytest.mark.parametrize("relative_path", ["../secret.png", "/tmp/secret.png", "C:/secret.png"])
def test_path_traversal_is_rejected(tmp_path: Path, relative_path: str) -> None:
    catalog = AssetCatalog(tmp_path / "storage")

    with pytest.raises(ApiError):
        catalog.resolve_relative_path(relative_path)


def test_storage_root_external_symlink_is_ignored(tmp_path: Path) -> None:
    catalog, images_dir, models_dir = _catalog_with_dirs(tmp_path)
    external = tmp_path / "external.png"
    external.write_bytes(PNG_BYTES)
    link = images_dir / "linked.png"
    try:
        os.symlink(external, link)
    except (OSError, NotImplementedError) as exc:
        pytest.skip(f"Symlink creation is unavailable: {exc}")

    catalog.reconcile(images_dir, models_dir)

    assert catalog.list_assets() == []


def test_trash_child_is_still_returned_by_dependency_query(tmp_path: Path) -> None:
    catalog, _, _ = _catalog_with_dirs(tmp_path)
    parent_id = str(uuid.uuid4())
    child_id = str(uuid.uuid4())
    catalog.upsert_asset(
        _asset_record(
            asset_id=parent_id,
            relative_path="images/parent.png",
            filename="parent.png",
        )
    )
    catalog.upsert_asset(
        _asset_record(
            asset_id=child_id,
            relative_path="images/child.png",
            filename="child.png",
            parent_image_id=parent_id,
            deleted_at="2026-01-01T00:00:00+00:00",
        )
    )

    children = catalog.find_children(parent_id)

    assert [child.asset_id for child in children] == [child_id]


def test_find_derived_assets_returns_calibrated_children_and_filters_unrelated(tmp_path: Path) -> None:
    catalog, _, _ = _catalog_with_dirs(tmp_path)
    raw_id = str(uuid.uuid4())
    calibrated_id = str(uuid.uuid4())
    unrelated_id = str(uuid.uuid4())
    catalog.upsert_asset(
        _asset_record(
            asset_id=raw_id,
            asset_type="model",
            relative_path="models/raw.glb",
            filename="raw.glb",
        )
    )
    catalog.upsert_asset(
        _asset_record(
            asset_id=calibrated_id,
            asset_type="model",
            relative_path="models/calibrated.glb",
            filename="calibrated.glb",
            parent_asset_id=raw_id,
        )
    )
    catalog.upsert_asset(
        _asset_record(
            asset_id=unrelated_id,
            asset_type="model",
            relative_path="models/unrelated.glb",
            filename="unrelated.glb",
        )
    )

    derived = catalog.find_derived_assets(raw_id)

    assert [asset.asset_id for asset in derived] == [calibrated_id]


def test_asset_storage_recovers_image_after_backend_restart(settings) -> None:
    app = create_app(settings)
    app.state.openai_client = None
    client = TestClient(app)
    upload = client.post(
        "/api/images/upload",
        files={"image": ("asset.png", PNG_BYTES, "image/png")},
    ).json()

    restarted = create_app(settings)
    record = restarted.state.storage.get_image_by_id(upload["image_id"])

    assert record.image_id == upload["image_id"]
    assert record.filename == upload["filename"]
    assert record.source == "uploaded"
    assert record.path.exists()


def test_model_asset_is_not_recovered_as_image(settings) -> None:
    settings.storage_models_dir.mkdir(parents=True, exist_ok=True)
    (settings.storage_models_dir / "legacy.glb").write_bytes(GLB_BYTES)
    app = create_app(settings)
    model = app.state.asset_catalog.list_assets(asset_type="model")[0]

    with pytest.raises(ApiError) as exc:
        app.state.storage.get_image_by_id(model.asset_id)

    assert exc.value.code == "image_not_found"


def test_missing_catalog_image_is_not_recovered(settings) -> None:
    settings.storage_images_dir.mkdir(parents=True, exist_ok=True)
    image_id = str(uuid.uuid4())
    image_path = settings.storage_images_dir / f"upload-{image_id}.png"
    image_path.write_bytes(PNG_BYTES)
    app = create_app(settings)
    image_path.unlink()
    app.state.asset_catalog.reconcile(settings.storage_images_dir, settings.storage_models_dir)

    with pytest.raises(ApiError) as exc:
        app.state.storage.get_image_by_id(image_id)

    assert exc.value.code == "image_not_found"


def test_registering_same_image_record_is_idempotent(settings) -> None:
    app = create_app(settings)
    record = app.state.storage.save_image_bytes(PNG_BYTES, "gpt", ".png", source="generated")
    app.state.storage._register_image_record(record)

    assets = app.state.asset_catalog.list_assets(asset_type="image")

    assert len([asset for asset in assets if asset.asset_id == record.image_id]) == 1


def test_registered_image_metadata_survives_restart(settings) -> None:
    app = create_app(settings)
    uploaded = app.state.storage.save_uploaded_image(PNG_BYTES, "original.png", "image/png")
    edited = app.state.storage.save_edited_image(PNG_BYTES, uploaded.image_id)

    restarted = create_app(settings)
    uploaded_asset = restarted.state.asset_catalog.get_asset(uploaded.image_id)
    edited_asset = restarted.state.asset_catalog.get_asset(edited.image_id)
    recovered = restarted.state.storage.get_image_by_id(edited.image_id)

    assert uploaded_asset.source == "uploaded"
    assert uploaded_asset.original_filename == "original.png"
    assert edited_asset.source == "edited"
    assert edited_asset.parent_image_id == uploaded.image_id
    assert recovered.image_id == edited.image_id
    assert recovered.source == "edited"
    assert recovered.parent_image_id == uploaded.image_id


def test_reconciliation_preserves_registered_metadata(settings) -> None:
    app = create_app(settings)
    uploaded = app.state.storage.save_uploaded_image(PNG_BYTES, "original.png", "image/png")
    app.state.asset_catalog.reconcile(settings.storage_images_dir, settings.storage_models_dir)

    asset = app.state.asset_catalog.get_asset(uploaded.image_id)

    assert asset.source == "uploaded"
    assert asset.original_filename == "original.png"


def test_image_catalog_registration_failure_does_not_return_success(settings) -> None:
    class FailingCatalog:
        def relative_path_for(self, path):
            return "images/orphan.png"

        def upsert_asset(self, record):
            raise RuntimeError("database unavailable")

    storage = AssetStorage(settings, FailingCatalog())

    with pytest.raises(ApiError) as exc:
        storage.save_image_bytes(PNG_BYTES, "gpt", ".png", source="generated")

    assert exc.value.code == "asset_catalog_failed"
    assert storage.images == {}
    assert list(settings.storage_images_dir.glob("gpt-*.png"))


def test_missing_model_file_is_not_registered(settings) -> None:
    app = create_app(settings)

    with pytest.raises(ApiError) as exc:
        app.state.storage.register_model_file(
            settings.storage_models_dir / "missing.glb",
            source="generated",
            pipeline="single",
            model_variant="single",
            related_job_id="job-1",
            reference_image_id="image-1",
        )

    assert exc.value.code == "model_not_found"
    assert app.state.asset_catalog.list_assets(asset_type="model") == []


def _catalog_with_dirs(tmp_path: Path) -> tuple[AssetCatalog, Path, Path]:
    storage_root = tmp_path / "storage"
    images_dir = storage_root / "images"
    models_dir = storage_root / "models"
    images_dir.mkdir(parents=True)
    models_dir.mkdir(parents=True)
    return AssetCatalog(storage_root), images_dir, models_dir


def _asset_record(**overrides) -> AssetRecord:
    values = {
        "asset_id": str(uuid.uuid4()),
        "asset_type": "image",
        "filename": "asset.png",
        "relative_path": "images/asset.png",
        "media_type": "image/png",
        "source": "legacy",
        "created_at": "2026-01-01T00:00:00+00:00",
        "deleted_at": None,
        "size_bytes": len(PNG_BYTES),
        "status": "available",
        "parent_image_id": None,
        "pipeline": None,
        "model_variant": None,
        "related_job_id": None,
        "reference_image_id": None,
        "view_name": None,
        "original_filename": None,
    }
    values.update(overrides)
    return AssetRecord(**values)
