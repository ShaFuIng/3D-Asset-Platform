from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .asset_catalog import AssetCatalog
from .asset_usage import AssetUsageGuard
from .config import Settings, settings
from .errors import register_error_handlers
from .routers import images, jobs_3d, library, multiview
from .services.blender_client import BlenderClient
from .services.comfy_client import ComfyClient, ComfyClientError
from .services.jobs import JobStore
from .services.multiview_jobs import MultiviewJobStore
from .services.multiview_workflows import HunyuanMultiviewWorkflow, QwenMultiviewWorkflow
from .services.openai_client import OpenAIImageClient
from .storage import AssetStorage


def create_app(app_settings: Settings = settings) -> FastAPI:
    app = FastAPI(title="3D Asset Platform API")
    app.state.settings = app_settings
    app.state.asset_catalog = AssetCatalog(app_settings.storage_images_dir.parent)
    app.state.asset_catalog.reconcile(app_settings.storage_images_dir, app_settings.storage_models_dir)
    app.state.storage = AssetStorage(app_settings, app.state.asset_catalog)
    app.state.asset_usage_guard = AssetUsageGuard()
    app.state.job_store = JobStore()
    app.state.multiview_job_store = MultiviewJobStore()
    app.state.background_tasks = set()
    app.state.comfy_client = ComfyClient(app_settings)
    app.state.blender_client = BlenderClient(app_settings)
    app.state.qwen_multiview_workflow = QwenMultiviewWorkflow(
        app_settings.qwen_multiview_workflow_path
    )
    app.state.hunyuan_multiview_workflow = HunyuanMultiviewWorkflow(
        app_settings.hunyuan_multiview_workflow_path
    )
    app.state.openai_client = OpenAIImageClient(app_settings)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ],
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["*"],
    )
    register_error_handlers(app)
    app.include_router(images.router)
    app.include_router(jobs_3d.router)
    app.include_router(library.router)
    app.include_router(multiview.router)
    register_health_routes(app)
    return app


def register_health_routes(app: FastAPI) -> None:
    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {
            "status": "connected",
            "service": "backend",
            "message": "FastAPI backend is running.",
        }

    @app.get("/api/comfy/health")
    async def comfy_health() -> dict[str, str]:
        try:
            await app.state.comfy_client.health()
        except ComfyClientError:
            return {
                "status": "disconnected",
                "service": "comfyui",
                "base_url": app.state.settings.comfyui_base_url,
                "message": "ComfyUI is not reachable.",
            }

        return {
            "status": "connected",
            "service": "comfyui",
            "base_url": app.state.settings.comfyui_base_url,
            "message": "ComfyUI API is reachable.",
        }


app = create_app()
