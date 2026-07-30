import asyncio
import copy
import json
import struct
from pathlib import Path
from typing import Any

import httpx

from ..config import Settings
from ..errors import ApiError


class ComfyClientError(Exception):
    pass


class ComfyClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def health(self) -> None:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                response = await client.get(f"{self.settings.comfyui_base_url}/system_stats")
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise ComfyClientError("ComfyUI is not reachable.") from exc

    async def ensure_available(self) -> None:
        try:
            await self.health()
        except ComfyClientError as exc:
            raise ApiError(503, "comfyui_unavailable", "ComfyUI is not reachable.") from exc

    async def upload_image(self, image_path: Path) -> str:
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                with image_path.open("rb") as image_file:
                    files = {"image": (image_path.name, image_file, "application/octet-stream")}
                    data = {"overwrite": "true"}
                    response = await client.post(
                        f"{self.settings.comfyui_base_url}/upload/image",
                        files=files,
                        data=data,
                    )
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, json.JSONDecodeError, OSError) as exc:
            raise ComfyClientError("ComfyUI image upload failed.") from exc

        name = payload.get("name")
        if not name:
            raise ComfyClientError("ComfyUI upload response did not include a file name.")
        return "/".join(part for part in [payload.get("subfolder"), name] if part)

    def load_workflow(self, comfy_image_name: str) -> dict[str, Any]:
        try:
            workflow = json.loads(self.settings.workflow_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ApiError(500, "workflow_invalid", "Hunyuan3D workflow is missing or invalid.") from exc

        if "2" not in workflow or "inputs" not in workflow["2"] or "image" not in workflow["2"]["inputs"]:
            raise ApiError(500, "workflow_invalid", "Workflow node 2 image input is missing.")
        if "10" not in workflow or workflow["10"].get("class_type") != "SaveGLB":
            raise ApiError(500, "workflow_invalid", "Workflow node 10 SaveGLB output is missing.")

        prepared = copy.deepcopy(workflow)
        prepared["2"]["inputs"]["image"] = comfy_image_name
        return prepared

    async def queue_prompt(self, workflow: dict[str, Any], client_id: str) -> str:
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.settings.comfyui_base_url}/prompt",
                    json={"prompt": workflow, "client_id": client_id},
                )
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, json.JSONDecodeError) as exc:
            raise ComfyClientError("ComfyUI prompt submission failed.") from exc

        prompt_id = payload.get("prompt_id")
        if not prompt_id:
            raise ComfyClientError("ComfyUI did not return a prompt id.")
        return prompt_id

    async def wait_for_glb_output(self, prompt_id: str) -> dict[str, str]:
        deadline = asyncio.get_running_loop().time() + self.settings.comfyui_job_timeout_seconds
        while asyncio.get_running_loop().time() < deadline:
            history = await self._history(prompt_id)
            job = history.get(prompt_id)
            if job is None:
                await asyncio.sleep(self.settings.comfyui_poll_interval_seconds)
                continue
            if job.get("status", {}).get("status_str") == "error":
                raise ComfyClientError("ComfyUI workflow failed.")
            output = job.get("outputs", {}).get("10")
            if output:
                glb = self.parse_glb_output(output)
                if glb:
                    return glb
            await asyncio.sleep(self.settings.comfyui_poll_interval_seconds)
        raise ComfyClientError("Timed out waiting for Hunyuan3D.")

    def parse_glb_output(self, output: dict[str, Any]) -> dict[str, str] | None:
        for key in ("3d", "gltf", "glb", "files"):
            values = output.get(key)
            if isinstance(values, list):
                for item in values:
                    if not isinstance(item, dict):
                        continue
                    filename = str(item.get("filename", ""))
                    if Path(filename).suffix.lower() != ".glb":
                        continue
                    return {
                        "filename": filename,
                        "subfolder": str(item.get("subfolder", "")),
                        "type": str(item.get("type", "output")),
                    }
        return None

    async def download_output(self, output: dict[str, str], destination: Path) -> None:
        params = {
            "filename": output.get("filename", ""),
            "subfolder": output.get("subfolder", ""),
            "type": output.get("type", "output"),
        }
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                response = await client.get(f"{self.settings.comfyui_base_url}/view", params=params)
                response.raise_for_status()
                content = response.content
                if not self._is_valid_glb(content):
                    raise ComfyClientError("ComfyUI returned an invalid GLB file.")
                destination.write_bytes(content)
        except ComfyClientError:
            raise
        except (httpx.HTTPError, OSError) as exc:
            raise ComfyClientError("ComfyUI GLB download failed.") from exc

    @staticmethod
    def _is_valid_glb(content: bytes) -> bool:
        if len(content) < 12 or content[:4] != b"glTF":
            return False
        version, declared_length = struct.unpack("<II", content[4:12])
        return version == 2 and declared_length == len(content)

    async def _history(self, prompt_id: str) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(f"{self.settings.comfyui_base_url}/history/{prompt_id}")
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, json.JSONDecodeError) as exc:
            raise ComfyClientError("ComfyUI history request failed.") from exc
        if not isinstance(payload, dict):
            raise ComfyClientError("ComfyUI history response was invalid.")
        return payload
