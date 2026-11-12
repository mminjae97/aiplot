# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from ..common import job_id
from . import beat_version


class BeatSaved(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    version: beat_version.BeatVersion
    jobId: job_id.JobId | None
