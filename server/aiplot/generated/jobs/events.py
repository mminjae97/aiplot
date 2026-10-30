# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictFloat, StrictInt, StrictStr


class JobProgressEvent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    done: Annotated[StrictInt, Field(ge=0)]
    total: Annotated[StrictInt, Field(ge=0)]
    etaSec: Annotated[
        StrictFloat | None,
        Field(
            description="Estimated seconds left; null until there is enough progress to estimate.",
            ge=0.0,
        ),
    ]
    step: Annotated[StrictStr | None, Field(description="What runs now, e.g. a file name.")]


class JobPausedEvent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    reason: Literal["user"]


class JobResumedEvent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )


class JobDoneEvent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    result: dict[str, Any]


class JobErrorEvent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    code: Annotated[StrictStr, Field(pattern="^[A-Z][A-Z0-9_]*$")]
    message: StrictStr


class JobCancelledEvent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )


type JobLifecycleEvent = Annotated[
    JobProgressEvent
    | JobPausedEvent
    | JobResumedEvent
    | JobDoneEvent
    | JobErrorEvent
    | JobCancelledEvent,
    Field(
        description="data of the SSE events every job can send on GET /jobs/{jobId}/events; the SSE event name is the type (§16). Job kinds add their own events (e.g. chapter: beat_start, sentence).",
        title="JobLifecycleEvent",
    ),
]
