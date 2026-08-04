from typing import Annotated

from fastapi import APIRouter, Query, Request
from fastapi.responses import FileResponse

from ..schemas import (
    DeleteLibraryAssetResponse,
    LibraryAssetListResponse,
    LibraryAssetResponse,
    LibraryAssetType,
    LibrarySort,
    LibraryState,
)
from ..services.library import (
    asset_content_path,
    asset_response,
    permanently_delete_asset,
    require_asset,
    restore_asset,
    trash_asset,
)

router = APIRouter()


@router.get("/api/library/assets", response_model=LibraryAssetListResponse)
async def list_library_assets(
    request: Request,
    asset_type: Annotated[LibraryAssetType | None, Query(alias="type")] = None,
    state: LibraryState = "active",
    source: str | None = None,
    pipeline: str | None = None,
    search: str | None = None,
    sort: LibrarySort = "created_at_desc",
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
) -> LibraryAssetListResponse:
    catalog = request.app.state.asset_catalog
    total = catalog.count_assets(
        asset_type=asset_type,
        state=state,
        source=source,
        pipeline=pipeline,
        search=search,
    )
    items = catalog.list_assets(
        asset_type=asset_type,
        state=state,
        source=source,
        pipeline=pipeline,
        search=search,
        sort=sort,
        page=page,
        page_size=page_size,
    )
    return LibraryAssetListResponse(
        items=[asset_response(asset) for asset in items],
        page=page,
        page_size=page_size,
        total=total,
    )


@router.get("/api/library/assets/{asset_id}", response_model=LibraryAssetResponse)
async def get_library_asset(request: Request, asset_id: str) -> LibraryAssetResponse:
    return asset_response(require_asset(request.app.state.asset_catalog, asset_id))


@router.get("/api/library/assets/{asset_id}/content")
async def get_library_asset_content(request: Request, asset_id: str) -> FileResponse:
    asset = require_asset(request.app.state.asset_catalog, asset_id)
    path = asset_content_path(request.app.state.asset_catalog, asset)
    return FileResponse(path, media_type=asset.media_type, filename=asset.filename)


@router.post("/api/library/assets/{asset_id}/trash", response_model=LibraryAssetResponse)
async def trash_library_asset(request: Request, asset_id: str) -> LibraryAssetResponse:
    return trash_asset(request.app.state.asset_catalog, asset_id)


@router.post("/api/library/assets/{asset_id}/restore", response_model=LibraryAssetResponse)
async def restore_library_asset(request: Request, asset_id: str) -> LibraryAssetResponse:
    return restore_asset(request.app.state.asset_catalog, asset_id)


@router.delete("/api/library/assets/{asset_id}", response_model=DeleteLibraryAssetResponse)
async def delete_library_asset(request: Request, asset_id: str) -> DeleteLibraryAssetResponse:
    return permanently_delete_asset(
        request.app.state.asset_catalog,
        request.app.state.asset_usage_guard,
        asset_id,
    )
