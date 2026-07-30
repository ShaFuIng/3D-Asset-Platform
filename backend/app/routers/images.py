from fastapi import APIRouter, Request, UploadFile, status
from fastapi.responses import FileResponse

from ..errors import ApiError
from ..schemas import GeneratedImageResponse, GenerateImageRequest, ImageResponse

router = APIRouter()


@router.get("/api/openai/health")
async def openai_health(request: Request) -> dict[str, str]:
    if request.app.state.settings.openai_api_key:
        return {
            "status": "configured",
            "service": "openai",
            "message": "OpenAI API key is configured.",
        }
    return {
        "status": "not_configured",
        "service": "openai",
        "message": "OPENAI_API_KEY is not configured.",
    }


@router.post(
    "/api/images/upload",
    response_model=ImageResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_image(request: Request, image: UploadFile) -> ImageResponse:
    content = await image.read()
    record = request.app.state.storage.save_uploaded_image(
        content,
        image.filename or "",
        image.content_type,
    )
    return ImageResponse(
        image_id=record.image_id,
        filename=record.filename,
        url=f"/api/assets/images/{record.filename}",
    )


@router.post(
    "/api/images/generate",
    response_model=GeneratedImageResponse,
    status_code=status.HTTP_201_CREATED,
)
async def generate_image(request: Request, payload: GenerateImageRequest) -> GeneratedImageResponse:
    image_bytes, image_prompt, response_id = await request.app.state.openai_client.generate_image(
        payload.messages,
        payload.previous_response_id,
    )
    record = request.app.state.storage.save_generated_image(image_bytes)
    return GeneratedImageResponse(
        image_id=record.image_id,
        filename=record.filename,
        url=f"/api/assets/images/{record.filename}",
        assistant_message="已依照你的需求生成圖片。",
        image_prompt=image_prompt,
        response_id=response_id,
    )


@router.get("/api/assets/images/{filename:path}")
async def get_image(request: Request, filename: str) -> FileResponse:
    path, media_type = request.app.state.storage.resolve_image_file(filename)
    if not path.exists():
        raise ApiError(404, "image_not_found", "Image was not found.")
    return FileResponse(path, media_type=media_type, filename=path.name)
