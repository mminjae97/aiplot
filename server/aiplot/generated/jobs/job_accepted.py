# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from ..common import job_id


class JobAccepted(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    jobId: job_id.JobId
