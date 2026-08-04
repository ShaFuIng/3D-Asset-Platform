import copy
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..errors import ApiError


VIEW_ORDER = ("front", "left", "back")

QWEN_PROMPTS: dict[str, str] = {
    "front": (
        "<sks> front view, eye-level shot, medium shot, keep the subject identity, "
        "proportions, clothing, accessories, colors and background consistent; only "
        "change the camera viewpoint."
    ),
    "left": (
        "<sks> left side view, eye-level shot, medium shot, keep the subject identity, "
        "proportions, clothing, accessories, colors and background consistent; only "
        "change the camera viewpoint."
    ),
    "back": (
        "<sks> back view, eye-level shot, medium shot, keep the subject identity, "
        "proportions, clothing, accessories, colors and background consistent; only "
        "change the camera viewpoint."
    ),
}


@dataclass(frozen=True)
class ComfyOutputRef:
    filename: str
    subfolder: str
    type: str

    def as_dict(self) -> dict[str, str]:
        return {
            "filename": self.filename,
            "subfolder": self.subfolder,
            "type": self.type,
        }


class QwenMultiviewWorkflow:
    def __init__(self, workflow_path: Path) -> None:
        self.workflow_path = workflow_path

    def prepare_three_view_workflow(
        self,
        comfy_reference_name: str,
        *,
        seed: int | None = None,
    ) -> dict[str, Any]:
        workflow = self._load_template()
        self._set_reference(workflow, comfy_reference_name)
        workflow["113"]["inputs"]["text"] = "\n".join(QWEN_PROMPTS[view] for view in VIEW_ORDER)
        if seed is not None:
            workflow["112:105"]["inputs"]["seed"] = seed
        return workflow

    def prepare_single_view_workflow(
        self,
        comfy_reference_name: str,
        view: str,
        *,
        seed: int | None = None,
    ) -> dict[str, Any]:
        if view not in VIEW_ORDER:
            raise ApiError(400, "invalid_view", "View must be front, left, or back.")
        workflow = self._load_template()
        self._set_reference(workflow, comfy_reference_name)
        workflow["113"]["inputs"]["text"] = QWEN_PROMPTS[view]
        if seed is not None:
            workflow["112:105"]["inputs"]["seed"] = seed
        return workflow

    def parse_three_view_outputs(self, history: dict[str, Any], prompt_id: str) -> dict[str, ComfyOutputRef]:
        images = self._images_from_history(history, prompt_id)
        if len(images) != len(VIEW_ORDER):
            raise ApiError(
                502,
                "qwen_output_count_invalid",
                "Qwen multiview workflow must return exactly three images.",
                {"expected": len(VIEW_ORDER), "actual": len(images)},
            )
        return {
            view: self._parse_output_ref(images[index], f"outputs.9.images.{index}")
            for index, view in enumerate(VIEW_ORDER)
        }

    def parse_single_view_output(self, history: dict[str, Any], prompt_id: str) -> ComfyOutputRef:
        images = self._images_from_history(history, prompt_id)
        if len(images) != 1:
            raise ApiError(
                502,
                "qwen_output_count_invalid",
                "Qwen single-view regenerate must return exactly one image.",
                {"expected": 1, "actual": len(images)},
            )
        return self._parse_output_ref(images[0], "outputs.9.images.0")

    def _load_template(self) -> dict[str, Any]:
        try:
            workflow = json.loads(self.workflow_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ApiError(500, "workflow_invalid", "Qwen multiview workflow is missing or invalid.") from exc
        self._validate_template(workflow)
        return copy.deepcopy(workflow)

    def _validate_template(self, workflow: dict[str, Any]) -> None:
        required = {
            "41": ("LoadImage", "image"),
            "113": ("TextToList", "text"),
            "112:105": ("KSampler", "seed"),
            "9": ("SaveImage", "images"),
        }
        for node_id, (class_type, input_name) in required.items():
            node = workflow.get(node_id)
            if not isinstance(node, dict) or node.get("class_type") != class_type:
                raise ApiError(500, "workflow_invalid", f"Qwen workflow node {node_id} is invalid.")
            inputs = node.get("inputs")
            if not isinstance(inputs, dict) or input_name not in inputs:
                raise ApiError(500, "workflow_invalid", f"Qwen workflow node {node_id} input is missing.")

    def _set_reference(self, workflow: dict[str, Any], comfy_reference_name: str) -> None:
        workflow["41"]["inputs"]["image"] = comfy_reference_name

    def _images_from_history(self, history: dict[str, Any], prompt_id: str) -> list[Any]:
        job = history.get(prompt_id)
        if not isinstance(job, dict):
            raise ApiError(502, "comfy_history_invalid", "ComfyUI history did not include the prompt id.")
        output = job.get("outputs", {}).get("9")
        if not isinstance(output, dict) or not isinstance(output.get("images"), list):
            raise ApiError(502, "qwen_output_missing", "Qwen output node 9 did not include images.")
        return output["images"]

    def _parse_output_ref(self, value: Any, path: str) -> ComfyOutputRef:
        if not isinstance(value, dict):
            raise ApiError(502, "qwen_output_invalid", f"{path} was not an object.")
        filename = value.get("filename")
        subfolder = value.get("subfolder")
        output_type = value.get("type")
        if not isinstance(filename, str) or not isinstance(subfolder, str) or not isinstance(output_type, str):
            raise ApiError(
                502,
                "qwen_output_invalid",
                "Qwen image output must include filename, subfolder, and type.",
                {"path": path},
            )
        return ComfyOutputRef(filename=filename, subfolder=subfolder, type=output_type)


class HunyuanMultiviewWorkflow:
    def __init__(self, workflow_path: Path) -> None:
        self.workflow_path = workflow_path

    def prepare_workflow(
        self,
        *,
        front: str,
        left: str,
        back: str,
        seed: int | None = None,
    ) -> dict[str, Any]:
        workflow = self._load_template()
        workflow["157"]["inputs"]["image"] = front
        workflow["160"]["inputs"]["image"] = left
        workflow["159"]["inputs"]["image"] = back
        if seed is not None:
            workflow["166"]["inputs"]["seed"] = seed
        return workflow

    def parse_model_outputs(self, history: dict[str, Any], prompt_id: str) -> dict[str, ComfyOutputRef]:
        return {
            "geometry": self._parse_result_ref(history, prompt_id, "162"),
            "textured": self._parse_result_ref(history, prompt_id, "154"),
        }

    def _load_template(self) -> dict[str, Any]:
        try:
            workflow = json.loads(self.workflow_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ApiError(500, "workflow_invalid", "Hunyuan multiview workflow is missing or invalid.") from exc
        self._validate_template(workflow)
        return copy.deepcopy(workflow)

    def _validate_template(self, workflow: dict[str, Any]) -> None:
        required = {
            "157": ("LoadImage", "image"),
            "160": ("LoadImage", "image"),
            "159": ("LoadImage", "image"),
            "166": ("Hy3DGenerateMeshMultiView", "front"),
            "162": ("Preview3D", "model_file"),
            "154": ("Preview3D", "model_file"),
        }
        for node_id, (class_type, input_name) in required.items():
            node = workflow.get(node_id)
            if not isinstance(node, dict) or node.get("class_type") != class_type:
                raise ApiError(500, "workflow_invalid", f"Hunyuan workflow node {node_id} is invalid.")
            inputs = node.get("inputs")
            if not isinstance(inputs, dict) or input_name not in inputs:
                raise ApiError(500, "workflow_invalid", f"Hunyuan workflow node {node_id} input is missing.")
        if "167" in workflow:
            raise ApiError(500, "workflow_invalid", "Hunyuan API workflow must not include the disabled right view.")

    def _parse_result_ref(self, history: dict[str, Any], prompt_id: str, node_id: str) -> ComfyOutputRef:
        job = history.get(prompt_id)
        if not isinstance(job, dict):
            raise ApiError(502, "comfy_history_invalid", "ComfyUI history did not include the prompt id.")
        output = job.get("outputs", {}).get(node_id)
        result = output.get("result") if isinstance(output, dict) else None
        if not isinstance(result, list) or len(result) == 0:
            raise ApiError(502, "hunyuan_output_missing", f"Hunyuan output node {node_id} did not include result.")
        return self._parse_glb_ref(result[0], f"outputs.{node_id}.result.0")

    def _parse_glb_ref(self, value: Any, path: str) -> ComfyOutputRef:
        if isinstance(value, dict):
            filename = value.get("filename")
            subfolder = value.get("subfolder", "")
            output_type = value.get("type", "output")
            if (
                isinstance(filename, str)
                and isinstance(subfolder, str)
                and isinstance(output_type, str)
                and Path(filename).suffix.lower() == ".glb"
            ):
                return ComfyOutputRef(filename=filename, subfolder=subfolder, type=output_type)
        if isinstance(value, str) and Path(value).suffix.lower() == ".glb":
            path_value = Path(value)
            subfolder = "" if str(path_value.parent) == "." else str(path_value.parent).replace("\\", "/")
            return ComfyOutputRef(filename=path_value.name, subfolder=subfolder, type="output")
        raise ApiError(
            502,
            "hunyuan_output_invalid",
            "Hunyuan model output must reference a GLB file.",
            {"path": path},
        )
