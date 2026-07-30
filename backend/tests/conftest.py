import base64
import struct
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.schemas import JobStatus


PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGA"
    "WjR9awAAAABJRU5ErkJggg=="
)
GLB_BYTES = b"glTF" + struct.pack("<II", 2, 12)


class FakeOpenAIClient:
    def __init__(self, image_bytes: bytes = PNG_BYTES, error=None) -> None:
        self.image_bytes = image_bytes
        self.error = error
        self.previous_response_id = None

    async def generate_image(self, messages, previous_response_id=None):
        self.previous_response_id = previous_response_id
        if self.error:
            raise self.error
        return self.image_bytes, "A revised prompt.", "response-123"


class FakeComfyClient:
    def __init__(self, *, available: bool = True, timeout: bool = False, workflow_error=None) -> None:
        self.available = available
        self.timeout = timeout
        self.workflow_error = workflow_error
        self.last_workflow = None

    async def health(self) -> None:
        if not self.available:
            from app.services.comfy_client import ComfyClientError

            raise ComfyClientError("ComfyUI is not reachable.")

    async def ensure_available(self) -> None:
        if not self.available:
            from app.errors import ApiError

            raise ApiError(503, "comfyui_unavailable", "ComfyUI is not reachable.")

    async def upload_image(self, image_path: Path) -> str:
        return image_path.name

    def load_workflow(self, comfy_image_name: str):
        if self.workflow_error:
            raise self.workflow_error
        workflow = {
            "2": {"inputs": {"image": comfy_image_name}},
            "10": {"class_type": "SaveGLB", "inputs": {"filename_prefix": "mesh/Chat3D"}},
        }
        self.last_workflow = workflow
        return workflow

    async def queue_prompt(self, workflow, client_id: str) -> str:
        self.last_workflow = workflow
        return "prompt-123"

    async def wait_for_glb_output(self, prompt_id: str):
        if self.timeout:
            from app.services.comfy_client import ComfyClientError

            raise ComfyClientError("Timed out waiting for Hunyuan3D.")
        return {"filename": "model.glb", "subfolder": "", "type": "output"}

    async def download_output(self, output, destination: Path) -> None:
        destination.write_bytes(GLB_BYTES)

    def parse_glb_output(self, output):
        from app.services.comfy_client import ComfyClient

        return ComfyClient(self.settings).parse_glb_output(output)


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        repository_root=tmp_path,
        comfyui_base_url="http://127.0.0.1:8188",
        openai_api_key=None,
        openai_response_model="gpt-5.6",
        storage_images_dir=tmp_path / "storage" / "images",
        storage_models_dir=tmp_path / "storage" / "models",
        workflow_path=tmp_path / "workflows" / "hunyuan3d_api.json",
        max_upload_bytes=1024,
        comfyui_job_timeout_seconds=0.01,
        comfyui_poll_interval_seconds=0.001,
    )


@pytest.fixture
def client(settings: Settings) -> TestClient:
    app = create_app(settings)
    app.state.openai_client = FakeOpenAIClient()
    app.state.comfy_client = FakeComfyClient()
    app.state.disable_background_jobs = True
    return TestClient(app)


@pytest.fixture
def image_id(client: TestClient) -> str:
    response = client.post(
        "/api/images/upload",
        files={"image": ("test.png", PNG_BYTES, "image/png")},
    )
    assert response.status_code == 201
    return response.json()["image_id"]


def make_job(job_id: str, status: JobStatus, model_path: Path | None = None, prompt_id: str | None = None):
    from app.services.jobs import Job

    return Job(
        job_id=job_id,
        status=status,
        message=f"job is {status.value}",
        prompt_id=prompt_id,
        model_path=model_path,
    )
