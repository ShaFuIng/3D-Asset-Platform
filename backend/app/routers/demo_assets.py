from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse

from ..errors import ApiError

router = APIRouter()

# Serves static demo assets for the AR preview stage (background photo, depth
# map, pre-baked alpha mask — see scripts/generate_ar_mask.py) straight out
# of demo-assets/ar-preview/. Deliberately separate from routers/images.py
# and storage.py: these files are not user-generated content, must never be
# picked up by AssetCatalog's rglob scan of storage/, and need no database
# record — just a plain static-file GET, same as the task calls for.
_MEDIA_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}


@router.get("/api/demo-assets/ar-preview/{filename}")
async def get_ar_preview_asset(request: Request, filename: str) -> FileResponse:
    # Reject anything but a bare filename (no subdirectories, no "..").
    if Path(filename).name != filename:
        raise ApiError(400, "invalid_path", "Invalid file path.")

    media_type = _MEDIA_TYPES.get(Path(filename).suffix.lower())
    if media_type is None:
        raise ApiError(404, "asset_not_found", "AR preview asset was not found.")

    directory: Path = request.app.state.settings.demo_ar_preview_dir
    path = (directory / filename).resolve()
    if not path.is_relative_to(directory.resolve()) or not path.is_file():
        raise ApiError(404, "asset_not_found", "AR preview asset was not found.")

    return FileResponse(path, media_type=media_type, filename=path.name)
