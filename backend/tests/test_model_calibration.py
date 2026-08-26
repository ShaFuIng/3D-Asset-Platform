import numpy as np
import pytest
import trimesh
from fastapi.testclient import TestClient
from PIL import Image

from app.errors import ApiError
from app.services.model_calibration import bake_calibrated_model
from tests.conftest import PNG_BYTES


def _make_textured_glb(path, *, max_dimension_m: float = 2.0) -> Image.Image:
    """Build a synthetic textured mesh and export it as a GLB. There is no
    real GLB fixture anywhere in this repo (the existing GLB_BYTES test
    constant is just fake magic bytes trimesh can't parse), so the
    calibration tests need to make their own -- this mirrors the fixture
    used to derive the timing/behavior numbers in the Phase 3 dev log.
    Returns the source texture image so callers can compare it byte-for-
    byte against whatever the calibrated GLB comes back with.
    """
    mesh = trimesh.creation.box(extents=[max_dimension_m, max_dimension_m / 2, max_dimension_m / 4])
    texture = Image.new("RGB", (16, 16))
    for x in range(16):
        for y in range(16):
            texture.putpixel((x, y), (x * 16, y * 16, 128))
    material = trimesh.visual.material.PBRMaterial(
        baseColorTexture=texture, baseColorFactor=[255, 255, 255, 255]
    )
    mesh.visual = trimesh.visual.TextureVisuals(uv=np.zeros((len(mesh.vertices), 2)), material=material)
    mesh.export(path)
    return texture


def _register_raw_model(client: TestClient, filename: str, *, max_dimension_m: float = 2.0):
    # Must live under storage.models_dir -- AssetCatalog.relative_path_for()
    # rejects any path outside storage_root, same as every other model-
    # registration test in this suite (see test_library.py).
    path = client.app.state.storage.models_dir / filename
    texture = _make_textured_glb(path, max_dimension_m=max_dimension_m)
    record = client.app.state.storage.register_model_file(
        path,
        source="generated",
        pipeline="single",
        model_variant="single",
        related_job_id="job-1",
        reference_image_id=None,
    )
    return record, texture


def _max_dimension_cm(path) -> float:
    scene = trimesh.load(path)
    bounds = scene.bounds
    return float(max(bounds[1] - bounds[0])) * 100.0


def test_calibrated_bounding_box_matches_target_within_tolerance(client: TestClient) -> None:
    raw, _texture = _register_raw_model(client, "raw.glb")

    calibrated = bake_calibrated_model(
        client.app.state.asset_catalog, client.app.state.storage, raw.asset_id, 15.0
    )

    calibrated_path = client.app.state.asset_catalog.resolve_relative_path(calibrated.relative_path)
    actual_cm = _max_dimension_cm(calibrated_path)
    assert abs(actual_cm - 15.0) < 0.01
    assert calibrated.parent_asset_id == raw.asset_id
    assert calibrated.asset_id != raw.asset_id


def test_recalibrating_same_raw_asset_does_not_accumulate_error(client: TestClient) -> None:
    raw, _texture = _register_raw_model(client, "raw.glb")

    first = bake_calibrated_model(
        client.app.state.asset_catalog, client.app.state.storage, raw.asset_id, 10.0
    )
    # Second call re-targets the same *raw* asset, not the first calibrated
    # result -- if scale were ever applied on top of an already-calibrated
    # GLB instead of re-deriving from raw every time, this second call would
    # drift off target.
    second = bake_calibrated_model(
        client.app.state.asset_catalog, client.app.state.storage, raw.asset_id, 20.0
    )

    first_path = client.app.state.asset_catalog.resolve_relative_path(first.relative_path)
    second_path = client.app.state.asset_catalog.resolve_relative_path(second.relative_path)
    assert abs(_max_dimension_cm(first_path) - 10.0) < 0.01
    assert abs(_max_dimension_cm(second_path) - 20.0) < 0.01
    assert first.asset_id != second.asset_id
    assert first.parent_asset_id == raw.asset_id
    assert second.parent_asset_id == raw.asset_id


def test_calibration_preserves_material_and_texture(client: TestClient) -> None:
    raw, source_texture = _register_raw_model(client, "raw.glb")

    calibrated = bake_calibrated_model(
        client.app.state.asset_catalog, client.app.state.storage, raw.asset_id, 15.0
    )

    calibrated_path = client.app.state.asset_catalog.resolve_relative_path(calibrated.relative_path)
    reloaded = trimesh.load(calibrated_path)
    geometry = next(iter(reloaded.geometry.values()))
    reloaded_texture = geometry.visual.material.baseColorTexture

    assert reloaded_texture is not None
    assert reloaded_texture.size == source_texture.size
    assert list(reloaded_texture.getdata()) == list(source_texture.getdata())


def test_calibrating_missing_asset_returns_404(client: TestClient) -> None:
    with pytest.raises(ApiError) as exc:
        bake_calibrated_model(
            client.app.state.asset_catalog, client.app.state.storage, "missing-asset-id", 10.0
        )

    assert exc.value.code == "asset_not_found"


def test_calibrating_non_model_asset_returns_400(client: TestClient) -> None:
    upload = client.post(
        "/api/images/upload",
        files={"image": ("asset.png", PNG_BYTES, "image/png")},
    ).json()

    with pytest.raises(ApiError) as exc:
        bake_calibrated_model(
            client.app.state.asset_catalog, client.app.state.storage, upload["image_id"], 10.0
        )

    assert exc.value.code == "invalid_asset_type"


def test_calibrating_non_positive_target_returns_400(client: TestClient) -> None:
    raw, _texture = _register_raw_model(client, "raw.glb")

    with pytest.raises(ApiError) as exc:
        bake_calibrated_model(client.app.state.asset_catalog, client.app.state.storage, raw.asset_id, 0.0)

    assert exc.value.code == "invalid_target_dimension"
