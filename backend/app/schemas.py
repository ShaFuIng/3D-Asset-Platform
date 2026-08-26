from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)

    @field_validator("content")
    @classmethod
    def content_must_not_be_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("content must not be blank")
        return stripped


class GenerateImageRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=20)
    previous_response_id: str | None = Field(default=None, min_length=1, max_length=200)

    @field_validator("messages")
    @classmethod
    def must_include_user_message(cls, value: list[ChatMessage]) -> list[ChatMessage]:
        if not any(message.role == "user" for message in value):
            raise ValueError("messages must include at least one user message")
        return value


class EditImageRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)

    @field_validator("prompt")
    @classmethod
    def prompt_must_not_be_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("prompt must not be blank")
        return stripped


class ImageResponse(BaseModel):
    image_id: str
    filename: str
    url: str


class GeneratedImageResponse(ImageResponse):
    assistant_message: str
    image_prompt: str | None
    response_id: str


class EditedImageResponse(ImageResponse):
    source: Literal["edited"]
    parent_image_id: str
    assistant_message: str
    image_prompt: str | None
    response_id: str


class Create3DJobRequest(BaseModel):
    image_id: str = Field(min_length=1)


class CreateMultiviewJobRequest(BaseModel):
    reference_image_id: str = Field(min_length=1)
    provider: Literal["local"] = "local"


class RegenerateStrategy(str, Enum):
    local_reroll = "local_reroll"
    openai_edit = "openai_edit"


class RegenerateMultiviewViewRequest(BaseModel):
    strategy: RegenerateStrategy
    instruction: str | None = Field(default=None, max_length=4000)

    @model_validator(mode="after")
    def validate_strategy_payload(self) -> "RegenerateMultiviewViewRequest":
        if self.strategy == RegenerateStrategy.local_reroll and self.instruction is not None:
            raise ValueError("instruction is not allowed for local_reroll")
        if self.strategy == RegenerateStrategy.openai_edit:
            instruction = (self.instruction or "").strip()
            if not instruction:
                raise ValueError("instruction is required for openai_edit")
            self.instruction = instruction
        return self


class JobStatus(str, Enum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"


class Create3DJobResponse(BaseModel):
    job_id: str
    status: JobStatus
    status_url: str


class JobResult(BaseModel):
    model_url: str


class JobResponse(BaseModel):
    job_id: str
    status: JobStatus
    message: str
    prompt_id: str | None
    result: JobResult | None


class MultiviewImageRef(BaseModel):
    image_id: str
    filename: str
    url: str


class SetMultiviewCandidateRequest(BaseModel):
    image_id: str = Field(min_length=1)


class MultiviewViewVersionResponse(BaseModel):
    image: MultiviewImageRef
    strategy: Literal["initial", "local_reroll", "openai_edit"]
    created_at: str
    is_current: bool
    is_candidate: bool
    available: bool
    state: Literal["active", "trash", "missing"]


class MultiviewSlotResponse(BaseModel):
    status: JobStatus
    current_image: MultiviewImageRef | None
    candidate_image: MultiviewImageRef | None
    accepted: bool
    error: str | None
    provider: Literal["local"]
    versions: list[MultiviewViewVersionResponse] = Field(default_factory=list)


class CreateMultiviewJobResponse(BaseModel):
    job_id: str
    status: JobStatus
    provider: Literal["local"]
    status_url: str


class MultiviewJobResponse(BaseModel):
    job_id: str
    status: JobStatus
    message: str
    provider: Literal["local"]
    prompt_id: str | None
    reference_image: MultiviewImageRef
    views: dict[str, MultiviewSlotResponse]


class MultiviewModelRef(BaseModel):
    available: bool
    download_url: str | None


class MultiviewModelJobResponse(BaseModel):
    status: JobStatus
    message: str
    prompt_id: str | None
    geometry_model: MultiviewModelRef
    textured_model: MultiviewModelRef


LibraryAssetType = Literal["image", "model"]
LibraryState = Literal["active", "trash"]
LibrarySort = Literal[
    "created_at_desc",
    "created_at_asc",
    "filename_asc",
    "filename_desc",
    "size_desc",
    "size_asc",
]


class LibraryAssetResponse(BaseModel):
    asset_id: str
    asset_type: LibraryAssetType
    content_url: str
    filename: str
    media_type: str
    source: str
    created_at: str
    deleted_at: str | None
    size_bytes: int
    status: str
    parent_image_id: str | None
    pipeline: str | None
    model_variant: str | None
    related_job_id: str | None
    reference_image_id: str | None
    view_name: str | None
    original_filename: str | None
    parent_asset_id: str | None
    calibrated_asset_ids: list[str]


class CalibrateAssetRequest(BaseModel):
    target_max_dimension_cm: float


class LibraryAssetListResponse(BaseModel):
    items: list[LibraryAssetResponse]
    page: int
    page_size: int
    total: int


class DeleteLibraryAssetResponse(BaseModel):
    deleted_asset_id: str
