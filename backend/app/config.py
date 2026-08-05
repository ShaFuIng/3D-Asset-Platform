import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(REPOSITORY_ROOT / ".env")


@dataclass(frozen=True)
class Settings:
    repository_root: Path
    comfyui_base_url: str
    openai_api_key: str | None
    openai_response_model: str
    storage_images_dir: Path
    storage_models_dir: Path
    demo_ar_preview_dir: Path
    workflow_path: Path
    qwen_multiview_workflow_path: Path
    hunyuan_multiview_workflow_path: Path
    max_upload_bytes: int
    comfyui_job_timeout_seconds: float
    comfyui_poll_interval_seconds: float

    @classmethod
    def from_env(cls) -> "Settings":
        root = REPOSITORY_ROOT
        return cls(
            repository_root=root,
            comfyui_base_url=os.getenv("COMFYUI_BASE_URL", "http://127.0.0.1:8188"),
            openai_api_key=os.getenv("OPENAI_API_KEY") or None,
            openai_response_model=os.getenv("OPENAI_RESPONSE_MODEL", "gpt-5.6"),
            storage_images_dir=root / "storage" / "images",
            storage_models_dir=root / "storage" / "models",
            # Static demo assets for the AR preview stage (background photo,
            # depth map, pre-baked alpha mask). Deliberately outside
            # storage/images/ so AssetCatalog's rglob scan never picks these
            # up — see backend/app/routers/demo_assets.py.
            demo_ar_preview_dir=root / "demo-assets" / "ar-preview",
            workflow_path=root / "workflows" / "hunyuan3d_api.json",
            qwen_multiview_workflow_path=(
                root / "workflows" / "Qwen_Image_Edit_2511_Front_Left_Back_Q3_K_M_API.json"
            ),
            hunyuan_multiview_workflow_path=root / "workflows" / "多角度3D生成_API.json",
            max_upload_bytes=int(os.getenv("MAX_UPLOAD_BYTES", str(8 * 1024 * 1024))),
            comfyui_job_timeout_seconds=float(os.getenv("COMFYUI_JOB_TIMEOUT_SECONDS", "900")),
            comfyui_poll_interval_seconds=float(os.getenv("COMFYUI_POLL_INTERVAL_SECONDS", "2")),
        )


settings = Settings.from_env()

