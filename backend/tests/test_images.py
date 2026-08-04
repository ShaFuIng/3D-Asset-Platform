import pytest
from fastapi.testclient import TestClient

from app.errors import ApiError
from tests.conftest import FakeOpenAIClient, PNG_BYTES


def test_upload_valid_png(client: TestClient) -> None:
    response = client.post(
        "/api/images/upload",
        files={"image": ("asset.png", PNG_BYTES, "image/png")},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["image_id"]
    assert data["filename"].startswith("upload-")
    assert data["filename"].endswith(".png")
    assert data["url"] == f"/api/assets/images/{data['filename']}"


@pytest.mark.parametrize(
    ("filename", "content", "content_type"),
    [
        ("asset.png", b"not-image", "image/png"),
        ("asset.txt", PNG_BYTES, "image/png"),
        ("asset.png", PNG_BYTES, "text/plain"),
    ],
)
def test_invalid_uploads_are_rejected(
    client: TestClient, filename: str, content: bytes, content_type: str
) -> None:
    response = client.post(
        "/api/images/upload",
        files={"image": (filename, content, content_type)},
    )
    assert response.status_code == 400
    assert "error" in response.json()


def test_large_upload_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/api/images/upload",
        files={"image": ("asset.png", PNG_BYTES + b"x" * 2048, "image/png")},
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "file_too_large"


def test_image_path_traversal_is_rejected(client: TestClient) -> None:
    response = client.get("/api/assets/images/%2E%2E%2Fsecret.png")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_path"


def test_get_uploaded_image(client: TestClient) -> None:
    upload = client.post(
        "/api/images/upload",
        files={"image": ("asset.png", PNG_BYTES, "image/png")},
    ).json()
    response = client.get(upload["url"])
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/png")


def test_generate_image_success(client: TestClient) -> None:
    client.app.state.settings = client.app.state.settings.__class__(
        **{**client.app.state.settings.__dict__, "openai_api_key": "test-key"}
    )
    client.app.state.openai_client = FakeOpenAIClient()
    response = client.post(
        "/api/images/generate",
        json={"messages": [{"role": "user", "content": "生成一個 3D 物件"}]},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["filename"].startswith("gpt-")
    assert data["assistant_message"] == "已依照你的需求生成圖片。"
    assert data["image_prompt"] == "A revised prompt."
    assert data["response_id"] == "response-123"


def test_generate_image_forwards_previous_response_id(client: TestClient) -> None:
    fake_openai_client = FakeOpenAIClient()
    client.app.state.openai_client = fake_openai_client

    response = client.post(
        "/api/images/generate",
        json={
            "messages": [{"role": "user", "content": "Remove the background."}],
            "previous_response_id": "response-previous",
        },
    )

    assert response.status_code == 201
    assert fake_openai_client.previous_response_id == "response-previous"


def test_generate_image_without_openai_key_returns_503(client: TestClient) -> None:
    client.app.state.openai_client = FakeOpenAIClient(
        error=ApiError(503, "openai_not_configured", "OPENAI_API_KEY is not configured.")
    )
    response = client.post(
        "/api/images/generate",
        json={"messages": [{"role": "user", "content": "生成一個 3D 物件"}]},
    )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "openai_not_configured"


def test_generate_image_openai_failure_returns_502(client: TestClient) -> None:
    client.app.state.openai_client = FakeOpenAIClient(
        error=ApiError(502, "openai_request_failed", "OpenAI image generation failed.")
    )
    response = client.post(
        "/api/images/generate",
        json={"messages": [{"role": "user", "content": "生成一個 3D 物件"}]},
    )
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "openai_request_failed"


def test_generate_image_invalid_messages(client: TestClient) -> None:
    response = client.post("/api/images/generate", json={"messages": []})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"


def test_uploaded_image_can_be_edited(client: TestClient) -> None:
    fake_openai_client = FakeOpenAIClient()
    client.app.state.openai_client = fake_openai_client
    upload = client.post(
        "/api/images/upload",
        files={"image": ("asset.png", PNG_BYTES, "image/png")},
    ).json()

    response = client.post(
        f"/api/images/{upload['image_id']}/edits",
        json={"prompt": "將服裝改成黑色，保留姿勢。"},
    )

    assert response.status_code == 201
    data = response.json()
    assert data["source"] == "edited"
    assert data["parent_image_id"] == upload["image_id"]
    assert data["image_id"] != upload["image_id"]
    assert data["filename"] != upload["filename"]
    assert data["filename"].startswith("edit-")
    assert data["assistant_message"] == "已依照你的要求產生修改版本。"
    assert data["image_prompt"] == "An edited prompt."
    assert data["response_id"] == "response-edit-123"
    assert client.get(data["url"]).status_code == 200
    source_response = client.get(upload["url"])
    assert source_response.status_code == 200
    assert source_response.content == PNG_BYTES
    assert fake_openai_client.edit_calls == [
        {
            "source_bytes": PNG_BYTES,
            "source_media_type": "image/png",
            "prompt": "將服裝改成黑色，保留姿勢。",
        }
    ]


def test_generated_image_can_be_edited(client: TestClient) -> None:
    client.app.state.openai_client = FakeOpenAIClient()
    generated = client.post(
        "/api/images/generate",
        json={"messages": [{"role": "user", "content": "生成一個 3D 物件"}]},
    ).json()

    response = client.post(
        f"/api/images/{generated['image_id']}/edits",
        json={"prompt": "改成黑色。"},
    )

    assert response.status_code == 201
    data = response.json()
    assert data["source"] == "edited"
    assert data["parent_image_id"] == generated["image_id"]
    assert data["image_id"] != generated["image_id"]
    assert data["filename"] != generated["filename"]
    assert client.get(generated["url"]).content == PNG_BYTES
    assert client.get(data["url"]).status_code == 200


def test_edit_missing_source_returns_404(client: TestClient) -> None:
    response = client.post(
        "/api/images/missing/edits",
        json={"prompt": "改成黑色。"},
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "image_not_found"


@pytest.mark.parametrize("prompt", ["", "   ", "x" * 4001])
def test_edit_invalid_prompt_returns_validation_error(client: TestClient, image_id: str, prompt: str) -> None:
    response = client.post(
        f"/api/images/{image_id}/edits",
        json={"prompt": prompt},
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"


def test_edit_openai_failure_returns_safe_error(client: TestClient, image_id: str) -> None:
    client.app.state.openai_client = FakeOpenAIClient(
        error=ApiError(502, "openai_request_failed", "OpenAI image edit failed.")
    )

    response = client.post(
        f"/api/images/{image_id}/edits",
        json={"prompt": "改成黑色。"},
    )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "openai_request_failed"


def test_edited_image_can_be_edited_again(client: TestClient, image_id: str) -> None:
    first = client.post(
        f"/api/images/{image_id}/edits",
        json={"prompt": "改成黑色。"},
    ).json()

    second_response = client.post(
        f"/api/images/{first['image_id']}/edits",
        json={"prompt": "再改成藍色。"},
    )

    assert second_response.status_code == 201
    second = second_response.json()
    assert second["source"] == "edited"
    assert second["parent_image_id"] == first["image_id"]
    assert second["image_id"] != first["image_id"]
