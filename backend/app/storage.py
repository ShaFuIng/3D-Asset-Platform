import imghdr
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from .asset_catalog import AssetCatalog, AssetRecord
from .config import Settings
from .errors import ApiError

ALLOWED_IMAGE_EXTENSIONS = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}

ALLOWED_IMAGE_FORMATS = {
    "PNG": ".png",
    "JPEG": ".jpg",
    "WEBP": ".webp",
}


@dataclass(frozen=True)
class ImageRecord:
    image_id: str
    filename: str
    path: Path
    media_type: str
    source: str
    parent_image_id: str | None = None


class AssetStorage:
    def __init__(self, settings: Settings, asset_catalog: AssetCatalog | None = None) -> None:
        self.settings = settings
        self.images_dir = settings.storage_images_dir
        self.models_dir = settings.storage_models_dir
        self.asset_catalog = asset_catalog
        self.images: dict[str, ImageRecord] = {}
        self.images_dir.mkdir(parents=True, exist_ok=True)
        self.models_dir.mkdir(parents=True, exist_ok=True)

    def validate_image_bytes(self, content: bytes, filename: str, content_type: str | None) -> str:
        if not content:
            raise ApiError(400, "empty_file", "Uploaded image is empty.")
        if len(content) > self.settings.max_upload_bytes:
            raise ApiError(413, "file_too_large", "Uploaded image is too large.")

        extension = Path(filename).suffix.lower()
        if extension not in ALLOWED_IMAGE_EXTENSIONS:
            raise ApiError(400, "unsupported_file_type", "Use PNG, JPG, JPEG, or WEBP.")
        if content_type not in set(ALLOWED_IMAGE_EXTENSIONS.values()):
            raise ApiError(400, "unsupported_media_type", "Image MIME type is not supported.")

        try:
            with Image.open(BytesIO(content)) as image:
                image.verify()
                image_format = image.format
        except (UnidentifiedImageError, OSError) as exc:
            raise ApiError(400, "invalid_image", "Uploaded file is not a valid image.") from exc

        expected_extension = ALLOWED_IMAGE_FORMATS.get(image_format or "")
        if expected_extension is None:
            raise ApiError(400, "invalid_image", "Uploaded file is not a supported image.")
        if extension == ".jpeg":
            extension = ".jpg"
        if extension != expected_extension:
            detected = imghdr.what(None, content)
            if detected != "jpeg" or expected_extension != ".jpg":
                raise ApiError(400, "invalid_image", "Image extension does not match image content.")
        return expected_extension

    def save_uploaded_image(self, content: bytes, filename: str, content_type: str | None) -> ImageRecord:
        extension = self.validate_image_bytes(content, filename, content_type)
        return self.save_image_bytes(
            content,
            "upload",
            extension,
            source="uploaded",
            original_filename=filename,
        )

    def save_generated_image(self, content: bytes) -> ImageRecord:
        self.validate_image_bytes(content, "generated.png", "image/png")
        return self.save_image_bytes(content, "gpt", ".png", source="generated")

    def save_edited_image(self, content: bytes, parent_image_id: str) -> ImageRecord:
        self.validate_image_bytes(content, "edited.png", "image/png")
        return self.save_image_bytes(
            content,
            "edit",
            ".png",
            source="edited",
            parent_image_id=parent_image_id,
        )

    def save_image_bytes(
        self,
        content: bytes,
        prefix: str,
        extension: str,
        *,
        source: str = "generated",
        parent_image_id: str | None = None,
        related_job_id: str | None = None,
        reference_image_id: str | None = None,
        view_name: str | None = None,
        original_filename: str | None = None,
    ) -> ImageRecord:
        image_id = str(uuid.uuid4())
        filename = f"{prefix}-{image_id}{extension}"
        path = self.images_dir / filename
        path.write_bytes(content)
        record = ImageRecord(
            image_id=image_id,
            filename=filename,
            path=path,
            media_type=ALLOWED_IMAGE_EXTENSIONS[extension],
            source=source,
            parent_image_id=parent_image_id,
        )
        self._register_image_record(
            record,
            related_job_id=related_job_id,
            reference_image_id=reference_image_id,
            view_name=view_name,
            original_filename=original_filename,
        )
        self.images[image_id] = record
        return record

    def register_model_file(
        self,
        path: Path,
        *,
        source: str,
        pipeline: str,
        model_variant: str,
        related_job_id: str,
        reference_image_id: str,
    ) -> AssetRecord:
        resolved = path.resolve()
        if not resolved.exists() or not resolved.is_file() or resolved.suffix.lower() != ".glb":
            raise ApiError(404, "model_not_found", "Generated GLB model was not found.")
        return self._register_asset(
            AssetRecord(
                asset_id=str(uuid.uuid4()),
                asset_type="model",
                filename=resolved.name,
                relative_path=self._relative_path_for_catalog(resolved),
                media_type="model/gltf-binary",
                source=source,
                created_at=_utc_now(),
                deleted_at=None,
                size_bytes=resolved.stat().st_size,
                status="available",
                pipeline=pipeline,
                model_variant=model_variant,
                related_job_id=related_job_id,
                reference_image_id=reference_image_id,
            )
        )

    def get_image_by_id(self, image_id: str) -> ImageRecord:
        record = self.images.get(image_id)
        if record is None:
            record = self._recover_image_from_catalog(image_id)
        if record is None or not record.path.exists():
            raise ApiError(404, "image_not_found", "Image was not found.")
        return record

    def resolve_image_file(self, filename: str) -> tuple[Path, str]:
        path = self._resolve_child(self.images_dir, filename)
        extension = path.suffix.lower()
        if extension not in ALLOWED_IMAGE_EXTENSIONS:
            raise ApiError(404, "image_not_found", "Image was not found.")
        if not path.exists() or not path.is_file():
            raise ApiError(404, "image_not_found", "Image was not found.")
        return path, ALLOWED_IMAGE_EXTENSIONS[extension]

    def model_path_for_job(self, job_id: str) -> Path:
        return self.models_dir / f"{job_id}.glb"

    def usdz_path_for_job(self, job_id: str) -> Path:
        return self.models_dir / f"{job_id}.usdz"

    def _resolve_child(self, root: Path, filename: str) -> Path:
        if Path(filename).name != filename:
            raise ApiError(400, "invalid_path", "Invalid file path.")
        path = (root / filename).resolve()
        root_resolved = root.resolve()
        if not path.is_relative_to(root_resolved):
            raise ApiError(400, "invalid_path", "Invalid file path.")
        return path

    def _recover_image_from_catalog(self, image_id: str) -> ImageRecord | None:
        if self.asset_catalog is None:
            return None
        asset = self.asset_catalog.get_asset(image_id)
        if asset is None or asset.asset_type != "image" or asset.status != "available":
            return None
        path = self.asset_catalog.resolve_relative_path(asset.relative_path)
        if not path.exists() or not path.is_file():
            return None
        record = ImageRecord(
            image_id=asset.asset_id,
            filename=asset.filename,
            path=path,
            media_type=asset.media_type,
            source=asset.source,
            parent_image_id=asset.parent_image_id,
        )
        self.images[image_id] = record
        return record

    def _register_image_record(
        self,
        record: ImageRecord,
        *,
        related_job_id: str | None = None,
        reference_image_id: str | None = None,
        view_name: str | None = None,
        original_filename: str | None = None,
    ) -> None:
        self._register_asset(
            AssetRecord(
                asset_id=record.image_id,
                asset_type="image",
                filename=record.filename,
                relative_path=self._relative_path_for_catalog(record.path),
                media_type=record.media_type,
                source=record.source,
                created_at=_utc_now(),
                deleted_at=None,
                size_bytes=record.path.stat().st_size,
                status="available",
                parent_image_id=record.parent_image_id,
                related_job_id=related_job_id,
                reference_image_id=reference_image_id,
                view_name=view_name,
                original_filename=original_filename,
            )
        )

    def _register_asset(self, record: AssetRecord) -> AssetRecord:
        if self.asset_catalog is None:
            return record
        try:
            return self.asset_catalog.upsert_asset(record)
        except ApiError:
            raise
        except Exception as exc:
            raise ApiError(500, "asset_catalog_failed", "Asset catalog registration failed.") from exc

    def _relative_path_for_catalog(self, path: Path) -> str:
        if self.asset_catalog is not None:
            return self.asset_catalog.relative_path_for(path)
        return path.resolve().relative_to(self.settings.storage_images_dir.parent.resolve()).as_posix()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()

