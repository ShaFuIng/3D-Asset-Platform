from app.schemas import ChatMessage
from app.services.openai_client import OpenAIImageClient


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
