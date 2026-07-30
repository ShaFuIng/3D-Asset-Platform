import asyncio
import base64
from types import SimpleNamespace

from app.schemas import ChatMessage
from app.services import openai_client as openai_client_module
from app.services.openai_client import IMAGE_GENERATION_INSTRUCTIONS, OpenAIImageClient


def test_to_response_input_serializes_user_message_as_input_text(settings):
    client = OpenAIImageClient(settings)

    result = client._to_response_input(
        [ChatMessage(role="user", content="Create a cat.")]
    )

    assert result == [
        {
            "role": "user",
            "content": [{"type": "input_text", "text": "Create a cat."}],
        }
    ]


def test_to_response_input_serializes_multi_turn_roles(settings):
    client = OpenAIImageClient(settings)

    result = client._to_response_input(
        [
            ChatMessage(role="user", content="Create a cat."),
            ChatMessage(role="assistant", content="The image was generated."),
            ChatMessage(role="user", content="Make the cat orange."),
        ]
    )

    assert result == [
        {
            "role": "user",
            "content": [{"type": "input_text", "text": "Create a cat."}],
        },
        {
            "role": "assistant",
            "content": [{"type": "output_text", "text": "The image was generated."}],
        },
        {
            "role": "user",
            "content": [{"type": "input_text", "text": "Make the cat orange."}],
        },
    ]


def test_generate_image_uses_previous_response_and_auto_action(settings, monkeypatch):
    captured_request = {}
    call_count = 0

    class FakeResponses:
        async def create(self, **kwargs):
            nonlocal call_count
            call_count += 1
            captured_request.update(kwargs)
            return SimpleNamespace(
                id="response-current",
                output=[
                    SimpleNamespace(
                        type="image_generation_call",
                        result=base64.b64encode(b"image-bytes").decode("ascii"),
                        revised_prompt="Remove the background.",
                    )
                ],
            )

    class FakeAsyncOpenAI:
        def __init__(self, api_key):
            self.responses = FakeResponses()

    monkeypatch.setattr(openai_client_module, "AsyncOpenAI", FakeAsyncOpenAI)
    configured_settings = settings.__class__(
        **{**settings.__dict__, "openai_api_key": "test-key"}
    )
    client = OpenAIImageClient(configured_settings)

    image_bytes, revised_prompt, response_id = asyncio.run(
        client.generate_image(
            [ChatMessage(role="user", content="Remove the background.")],
            previous_response_id="response-previous",
        )
    )

    assert image_bytes == b"image-bytes"
    assert revised_prompt == "Remove the background."
    assert response_id == "response-current"
    assert captured_request["previous_response_id"] == "response-previous"
    assert captured_request["instructions"] == IMAGE_GENERATION_INSTRUCTIONS
    assert captured_request["tools"] == [
        {"type": "image_generation", "action": "auto"}
    ]
    assert call_count == 1


def test_generate_image_first_turn_uses_instructions_and_auto_action(settings, monkeypatch):
    captured_request = {}
    call_count = 0

    class FakeResponses:
        async def create(self, **kwargs):
            nonlocal call_count
            call_count += 1
            captured_request.update(kwargs)
            return SimpleNamespace(
                id="response-first",
                output=[
                    SimpleNamespace(
                        type="image_generation_call",
                        result=base64.b64encode(b"image-bytes").decode("ascii"),
                        revised_prompt=None,
                    )
                ],
            )

    class FakeAsyncOpenAI:
        def __init__(self, api_key):
            self.responses = FakeResponses()

    monkeypatch.setattr(openai_client_module, "AsyncOpenAI", FakeAsyncOpenAI)
    configured_settings = settings.__class__(
        **{**settings.__dict__, "openai_api_key": "test-key"}
    )
    client = OpenAIImageClient(configured_settings)

    image_bytes, revised_prompt, response_id = asyncio.run(
        client.generate_image([ChatMessage(role="user", content="Create a cat.")])
    )

    assert image_bytes == b"image-bytes"
    assert revised_prompt is None
    assert response_id == "response-first"
    assert "previous_response_id" not in captured_request
    assert captured_request["instructions"] == IMAGE_GENERATION_INSTRUCTIONS
    assert captured_request["tools"] == [
        {"type": "image_generation", "action": "auto"}
    ]
    assert call_count == 1
