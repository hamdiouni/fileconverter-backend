from __future__ import annotations
from enum import Enum
from typing import Optional
from pydantic import BaseModel


class JobStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class ConversionOptions(BaseModel):
    quality: Optional[int] = None
    preserve_metadata: Optional[bool] = False
    codec: Optional[str] = None
    bitrate: Optional[str] = None
    standalone: Optional[bool] = False
    preserve_structure: Optional[bool] = True


class ConversionJob(BaseModel):
    id: str
    user_id: str
    source_file_id: str
    source_format: str
    target_format: str
    status: JobStatus
    options: Optional[ConversionOptions] = None


class JobResult(BaseModel):
    job_id: str
    result_file_id: str
    output_size: int
    processing_time_ms: int
