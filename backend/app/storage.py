import imghdr
import uuid
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from PIL import Image, UnidentifiedImageError

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
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.images_dir = settings.storage_images_dir
        self.models_dir = settings.storage_models_dir
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
        return self.save_image_bytes(content, "upload", extension, source="uploaded")

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
        self.images[image_id] = record
        return record

    def get_image_by_id(self, image_id: str) -> ImageRecord:
        record = self.images.get(image_id)
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

    def _resolve_child(self, root: Path, filename: str) -> Path:
        if Path(filename).name != filename:
            raise ApiError(400, "invalid_path", "Invalid file path.")
        path = (root / filename).resolve()
        root_resolved = root.resolve()
        if not path.is_relative_to(root_resolved):
            raise ApiError(400, "invalid_path", "Invalid file path.")
        return path

