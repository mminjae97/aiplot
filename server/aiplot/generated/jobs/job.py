# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from ..common import job_id, work_id
from . import events


class Job(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    jobId: job_id.JobId
    kind: Annotated[
        StrictStr,
        Field(
            description="What the job does, e.g. chapter, plan, download.",
            pattern="^[a-z][a-z_]*$",
        ),
    ]
    workId: work_id.WorkId | None
    status: Literal["queued", "running", "paused", "done", "failed", "cancelled"]
    createdAt: Annotated[StrictStr, Field(description="ISO 8601 UTC.")]
    startedAt: StrictStr | None
    finishedAt: StrictStr | None
    lastEventId: Annotated[
        StrictInt,
        Field(
            description="Id of the newest event; pass it as Last-Event-ID to resume the stream.",
            ge=0,
        ),
    ]
    error: events.JobErrorEvent | None
