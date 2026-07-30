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
