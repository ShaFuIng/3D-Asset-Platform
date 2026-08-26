import uuid

import trimesh

from ..asset_catalog import AssetCatalog, AssetRecord
from ..errors import ApiError
from ..storage import AssetStorage
from .library import asset_content_path, require_asset


def bake_calibrated_model(
    catalog: AssetCatalog,
    storage: AssetStorage,
    asset_id: str,
    target_max_dimension_cm: float,
) -> AssetRecord:
    """Produce a real-world-scaled GLB derived from a raw model asset.

    Measures the raw GLB's bounding box, computes the scale factor needed
    to make its longest edge equal `target_max_dimension_cm`, and writes a
    new GLB whose vertex data is *already* in that real-world scale (see
    `_load_and_bake_scale` for why this bakes the scale into the geometry
    itself rather than leaving it as a glTF node transform). The new asset
    is registered in the catalog with `parent_asset_id` pointing back at
    the raw asset -- every call re-measures and re-derives from the raw
    GLB from scratch, so repeated calibration never accumulates error.

    Pure sync function: measured well under 100ms even for a
    heavier-than-typical mesh (10k vertices, 1024x1024 texture), so this
    runs inline rather than through a background job -- see the Phase 3
    dev log for the timing this is based on.
    """
    if target_max_dimension_cm <= 0:
        raise ApiError(
            400,
            "invalid_target_dimension",
            "Target dimension must be a positive number of centimeters.",
        )

    raw_asset = require_asset(catalog, asset_id)
    if raw_asset.asset_type != "model":
        raise ApiError(400, "invalid_asset_type", "Calibration is only available for model assets.")
    raw_path = asset_content_path(catalog, raw_asset)

    baked_scene = _load_and_bake_scale(raw_path, target_max_dimension_cm)

    new_asset_id = str(uuid.uuid4())
    output_path = storage.models_dir / f"{new_asset_id}-calibrated.glb"
    baked_scene.export(output_path)

    return storage.register_model_file(
        output_path,
        source="calibrated",
        pipeline=raw_asset.pipeline,
        model_variant=raw_asset.model_variant,
        related_job_id=raw_asset.related_job_id,
        reference_image_id=raw_asset.reference_image_id,
        asset_id=new_asset_id,
        parent_asset_id=raw_asset.asset_id,
    )


def _load_and_bake_scale(raw_path, target_max_dimension_cm: float) -> trimesh.Scene:
    # trimesh.load() on a .glb always returns a Scene, never a bare Trimesh
    # -- true even for a GLB that was exported from a single Trimesh --
    # because glTF itself is a scene-graph format. Never assume otherwise.
    scene = trimesh.load(raw_path)

    bounds = scene.bounds
    max_dimension_m = float(max(bounds[1] - bounds[0]))
    if max_dimension_m <= 0:
        raise ApiError(422, "model_has_no_extent", "Model has zero or invalid bounding box.")

    target_m = target_max_dimension_cm / 100.0
    scale_factor = target_m / max_dimension_m

    # Scene.apply_scale() only rewrites the glTF node's transform matrix; it
    # does NOT touch the underlying mesh vertex buffers (verified empirically
    # -- see the Phase 3 dev log). That is spec-correct and any glTF-compliant
    # viewer (model-viewer, Three.js, Blender) renders it correctly, but it
    # means the raw vertex data alone is silently still in the old scale.
    # scene.dump() bakes each geometry's current world transform into its own
    # vertex data, so the exported GLB's vertex buffers are themselves real-
    # world-scaled -- correct regardless of whether a downstream consumer
    # respects node transforms.
    scene.apply_scale(scale_factor)
    baked_geometries = scene.dump(concatenate=False)
    return trimesh.Scene(baked_geometries)
