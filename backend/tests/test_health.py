from fastapi.testclient import TestClient

from tests.conftest import FakeComfyClient


def test_health_contract(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "connected",
        "service": "backend",
        "message": "FastAPI backend is running.",
    }


def test_comfy_health_disconnected_contract(client: TestClient) -> None:
    client.app.state.comfy_client = FakeComfyClient(available=False)
    response = client.get("/api/comfy/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "disconnected"
    assert data["service"] == "comfyui"
    assert data["base_url"] == "http://127.0.0.1:8188"
    assert data["message"] == "ComfyUI is not reachable."


def test_openai_health_without_key(client: TestClient) -> None:
    response = client.get("/api/openai/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "not_configured",
        "service": "openai",
        "message": "OPENAI_API_KEY is not configured.",
    }


def test_openai_health_with_key(client: TestClient) -> None:
    client.app.state.settings = client.app.state.settings.__class__(
        **{**client.app.state.settings.__dict__, "openai_api_key": "test-key"}
    )
    response = client.get("/api/openai/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "configured",
        "service": "openai",
        "message": "OpenAI API key is configured.",
    }
