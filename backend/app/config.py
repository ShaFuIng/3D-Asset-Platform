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
    workflow_path: Path
    qwen_multiview_workflow_path: Path
    hunyuan_multiview_workflow_path: Path
    max_upload_bytes: int
    comfyui_job_timeout_seconds: float
    comfyui_poll_interval_seconds: float
    blender_glb_to_usdz_script_path: Path
    # BLENDER_EXECUTABLE points at the extracted tarball's binary (e.g.
    # ~/.local/opt/blender/blender via a version symlink), not a Flatpak
    # install -- see docs/development-log/kila606/2026-08-08-blender-usdz-conversion.md.
    blender_executable: str | None = None
    blender_conversion_timeout_seconds: float = 300.0

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
            workflow_path=root / "workflows" / "hunyuan3d_api.json",
            qwen_multiview_workflow_path=(
                root / "workflows" / "Qwen_Image_Edit_2511_Front_Left_Back_Q3_K_M_API.json"
            ),
            hunyuan_multiview_workflow_path=root / "workflows" / "多角度3D生成_API.json",
            max_upload_bytes=int(os.getenv("MAX_UPLOAD_BYTES", str(8 * 1024 * 1024))),
            comfyui_job_timeout_seconds=float(os.getenv("COMFYUI_JOB_TIMEOUT_SECONDS", "900")),
            comfyui_poll_interval_seconds=float(os.getenv("COMFYUI_POLL_INTERVAL_SECONDS", "2")),
            blender_glb_to_usdz_script_path=root / "blender_scripts" / "glb_to_usdz.py",
            blender_executable=os.getenv("BLENDER_EXECUTABLE") or None,
            blender_conversion_timeout_seconds=float(
                os.getenv("BLENDER_CONVERSION_TIMEOUT_SECONDS", "300")
            ),
        )


settings = Settings.from_env()

