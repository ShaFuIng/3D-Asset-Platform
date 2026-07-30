from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, field_validator


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

    @field_validator("messages")
    @classmethod
    def must_include_user_message(cls, value: list[ChatMessage]) -> list[ChatMessage]:
        if not any(message.role == "user" for message in value):
            raise ValueError("messages must include at least one user message")
        return value


class ImageResponse(BaseModel):
    image_id: str
    filename: str
    url: str


class GeneratedImageResponse(ImageResponse):
    assistant_message: str
    image_prompt: str | None


class Create3DJobRequest(BaseModel):
    image_id: str = Field(min_length=1)


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

