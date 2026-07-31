import base64
import binascii
import logging
from typing import Any

from openai import APIError, AsyncOpenAI, OpenAIError

from ..config import Settings
from ..errors import ApiError
from ..schemas import ChatMessage

logger = logging.getLogger(__name__)

IMAGE_GENERATION_INSTRUCTIONS = """
Create image outputs that are suitable as 3D generation references.
Keep the complete main subject centered and fully visible with comfortable margins.
Use a clean, simple, uncluttered background.
Maintain a clear and unobstructed silhouette.
Avoid cropped body parts or object parts.
Avoid text, watermarks, frames, and unrelated props.
Avoid strong perspective distortion and motion blur.
During edits, preserve identity, proportions, pose, clothing, accessories, colors,
and other details unless the user explicitly requests changing them.
Do not force a fixed art style; follow the user's requested subject, content, and style.
""".strip()


class OpenAIImageClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def generate_image(
        self,
        messages: list[ChatMessage],
        previous_response_id: str | None = None,
    ) -> tuple[bytes, str | None, str]:
        if not self.settings.openai_api_key:
            raise ApiError(503, "openai_not_configured", "OPENAI_API_KEY is not configured.")

        client = AsyncOpenAI(api_key=self.settings.openai_api_key)
        response_request: dict[str, Any] = {
            "model": self.settings.openai_response_model,
            "instructions": IMAGE_GENERATION_INSTRUCTIONS,
            "input": self._to_response_input(messages),
            "tools": [{"type": "image_generation", "action": "auto"}],
            "tool_choice": {"type": "image_generation"},
        }
        if previous_response_id:
            response_request["previous_response_id"] = previous_response_id

        try:
            response = await client.responses.create(**response_request)
        except (APIError, OpenAIError) as exc:
            log_openai_error(exc)
            raise ApiError(502, "openai_request_failed", "OpenAI image generation failed.") from exc

        image_call = next(
            (output for output in response.output if output.type == "image_generation_call"),
            None,
        )
        if image_call is None:
            raise ApiError(
                502,
                "openai_image_missing",
                "OpenAI did not return an image generation result.",
            )

        try:
            image_bytes = base64.b64decode(image_call.result, validate=True)
        except (binascii.Error, TypeError) as exc:
            raise ApiError(502, "openai_invalid_image", "OpenAI returned invalid image data.") from exc

        return image_bytes, getattr(image_call, "revised_prompt", None), response.id

    def _to_response_input(self, messages: list[ChatMessage]) -> list[dict[str, object]]:
        return [
            {
                "role": message.role,
                "content": [
                    {
                        "type": "output_text" if message.role == "assistant" else "input_text",
                        "text": message.content,
                    }
                ],
            }
            for message in messages
        ]


def log_openai_error(exc: OpenAIError) -> None:
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", {}) or {}
    status_code = getattr(exc, "status_code", None) or getattr(response, "status_code", None)
    request_id = (
        getattr(exc, "request_id", None)
        or getattr(exc, "_request_id", None)
        or headers.get("x-request-id")
    )
    error_code = getattr(exc, "code", None) or _error_body_value(exc, "code")
    safe_message = _safe_error_message(exc)

    logger.warning(
        "OpenAI image generation failed: type=%s status_code=%s error_code=%s request_id=%s message=%s",
        type(exc).__name__,
        status_code or "unknown",
        error_code or "unknown",
        request_id or "unknown",
        safe_message,
    )


def _error_body_value(exc: OpenAIError, key: str) -> str | None:
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict):
            value = error.get(key)
            return str(value) if value is not None else None
        value = body.get(key)
        return str(value) if value is not None else None
    return None


def _safe_error_message(exc: OpenAIError) -> str:
    message: Any = getattr(exc, "message", None) or _error_body_value(exc, "message")
    if message is None:
        message = str(exc) or type(exc).__name__
    return " ".join(str(message).split())[:500]
