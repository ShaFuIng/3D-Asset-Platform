import base64
import binascii

from openai import APIError, AsyncOpenAI, OpenAIError

from ..config import Settings
from ..errors import ApiError
from ..schemas import ChatMessage


class OpenAIImageClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def generate_image(self, messages: list[ChatMessage]) -> tuple[bytes, str | None]:
        if not self.settings.openai_api_key:
            raise ApiError(503, "openai_not_configured", "OPENAI_API_KEY is not configured.")

        client = AsyncOpenAI(api_key=self.settings.openai_api_key)
        try:
            response = await client.responses.create(
                model=self.settings.openai_response_model,
                input=self._to_response_input(messages),
                tools=[{"type": "image_generation", "action": "generate"}],
                tool_choice={"type": "image_generation"},
            )
        except (APIError, OpenAIError) as exc:
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

        return image_bytes, getattr(image_call, "revised_prompt", None)

    def _to_response_input(self, messages: list[ChatMessage]) -> list[dict[str, object]]:
        return [
            {
                "role": message.role,
                "content": [{"type": "input_text", "text": message.content}],
            }
            for message in messages
        ]

