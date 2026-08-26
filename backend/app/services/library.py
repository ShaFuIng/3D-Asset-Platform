from pathlib import Path

from ..asset_catalog import AssetCatalog, AssetRecord
from ..asset_usage import AssetUsageGuard
from ..errors import ApiError
from ..schemas import DeleteLibraryAssetResponse, LibraryAssetResponse


def asset_response(catalog: AssetCatalog, asset: AssetRecord) -> LibraryAssetResponse:
    return LibraryAssetResponse(
        asset_id=asset.asset_id,
        asset_type=asset.asset_type,
        content_url=f"/api/library/assets/{asset.asset_id}/content",
        filename=asset.filename,
        media_type=asset.media_type,
        source=asset.source,
        created_at=asset.created_at,
        deleted_at=asset.deleted_at,
        size_bytes=asset.size_bytes,
        status=asset.status,
        parent_image_id=asset.parent_image_id,
        pipeline=asset.pipeline,
        model_variant=asset.model_variant,
        related_job_id=asset.related_job_id,
        reference_image_id=asset.reference_image_id,
        view_name=asset.view_name,
        original_filename=asset.original_filename,
        parent_asset_id=asset.parent_asset_id,
        calibrated_asset_ids=[
            child.asset_id
            for child in catalog.find_derived_assets(asset.asset_id)
            if child.deleted_at is None
        ],
    )


def require_asset(catalog: AssetCatalog, asset_id: str) -> AssetRecord:
    asset = catalog.get_asset(asset_id)
    if asset is None:
        raise ApiError(404, "asset_not_found", "Asset was not found.")
    return asset


def asset_content_path(catalog: AssetCatalog, asset: AssetRecord) -> Path:
    try:
        path = catalog.resolve_relative_path(asset.relative_path)
    except ApiError:
        raise
    except Exception as exc:
        raise ApiError(400, "invalid_path", "Invalid asset path.") from exc
    if asset.status == "missing" or not path.exists() or not path.is_file():
        raise ApiError(409, "asset_missing", "Asset file is missing.")
    return path


def trash_asset(catalog: AssetCatalog, asset_id: str) -> LibraryAssetResponse:
    asset = catalog.trash_asset(asset_id)
    if asset is None:
        raise ApiError(404, "asset_not_found", "Asset was not found.")
    return asset_response(catalog, asset)


def restore_asset(catalog: AssetCatalog, asset_id: str) -> LibraryAssetResponse:
    asset = require_asset(catalog, asset_id)
    asset_content_path(catalog, asset)
    restored = catalog.restore_asset(asset_id)
    if restored is None:
        raise ApiError(404, "asset_not_found", "Asset was not found.")
    return asset_response(catalog, restored)


async def permanently_delete_asset(
    catalog: AssetCatalog,
    usage_guard: AssetUsageGuard,
    multiview_job_store,
    asset_id: str,
) -> DeleteLibraryAssetResponse:
    asset = require_asset(catalog, asset_id)
    if asset.deleted_at is None:
        raise ApiError(409, "asset_not_in_trash", "Asset must be in trash before permanent delete.")
    _ensure_no_dependencies(catalog, asset)
    await _ensure_no_live_current_or_candidate(multiview_job_store, asset.asset_id)
    _ensure_not_in_use(usage_guard, asset.asset_id)
    path = catalog.resolve_relative_path(asset.relative_path)
    if path.exists():
        if not path.is_file():
            raise ApiError(409, "asset_delete_failed", "Asset file could not be deleted.")
        try:
            path.unlink()
        except PermissionError as exc:
            raise ApiError(409, "asset_file_locked", "Asset file is currently locked.") from exc
        except OSError as exc:
            raise ApiError(409, "asset_delete_failed", "Asset file could not be deleted.") from exc
    try:
        catalog.delete_asset_record(asset.asset_id)
    except Exception as exc:
        raise ApiError(500, "asset_catalog_failed", "Asset catalog update failed.") from exc
    await multiview_job_store.prune_history_version(asset.asset_id)
    return DeleteLibraryAssetResponse(deleted_asset_id=asset.asset_id)


def _ensure_no_dependencies(catalog: AssetCatalog, asset: AssetRecord) -> None:
    if asset.asset_type == "image":
        candidates = [*catalog.find_children(asset.asset_id), *catalog.find_references(asset.asset_id)]
    elif asset.asset_type == "model":
        candidates = catalog.find_derived_assets(asset.asset_id)
    else:
        return
    dependents = [dependent for dependent in candidates if dependent.asset_id != asset.asset_id]
    if dependents:
        raise ApiError(
            409,
            "asset_in_use",
            "Asset is still referenced by other assets.",
            {
                "dependents": [
                    {
                        "asset_id": dependent.asset_id,
                        "asset_type": dependent.asset_type,
                        "status": dependent.status,
                    }
                    for dependent in dependents
                ]
            },
        )


def _ensure_not_in_use(usage_guard: AssetUsageGuard, asset_id: str) -> None:
    uses = usage_guard.get_uses(asset_id)
    if not uses:
        return
    raise ApiError(
        409,
        "asset_in_use",
        "Asset is currently being used by a running operation.",
        {
            "uses": [
                {
                    "owner": use.owner,
                    "reason": use.reason,
                }
                for use in uses
            ]
        },
    )


async def _ensure_no_live_current_or_candidate(multiview_job_store, asset_id: str) -> None:
    references = await multiview_job_store.find_live_asset_references(asset_id)
    blockers = [reference for reference in references if reference["role"] in {"current", "candidate"}]
    if not blockers:
        return
    raise ApiError(
        409,
        "asset_in_use",
        "Asset is currently used by a multiview job.",
        {"references": blockers},
    )
