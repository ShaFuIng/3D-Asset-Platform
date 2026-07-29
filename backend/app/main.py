import os
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")
COMFYUI_BASE_URL = os.getenv("COMFYUI_BASE_URL", "http://127.0.0.1:8188")

app = FastAPI(title="3D Asset Platform API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


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
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.get(f"{COMFYUI_BASE_URL}/system_stats")
            response.raise_for_status()
    except httpx.HTTPError as exc:
        return {
            "status": "disconnected",
            "service": "comfyui",
            "base_url": COMFYUI_BASE_URL,
            "message": f"ComfyUI is not reachable: {exc}",
        }

    return {
        "status": "connected",
        "service": "comfyui",
        "base_url": COMFYUI_BASE_URL,
        "message": "ComfyUI API is reachable.",
    }
