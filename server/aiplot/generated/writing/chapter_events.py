# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from ..common import beat_id


class BeatStartEvent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    beatId: beat_id.BeatId


class SentenceEvent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    beatId: beat_id.BeatId
    text: Annotated[StrictStr, Field(min_length=1)]


class BeatDoneEvent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    beatId: beat_id.BeatId
    chars: Annotated[
        StrictInt,
        Field(
            description="Characters incl. spaces, counted in code; line breaks are not counted.",
            ge=0,
        ),
    ]
    version: Annotated[StrictInt, Field(ge=1)]


type ChapterJobEvent = Annotated[
    BeatStartEvent | SentenceEvent | BeatDoneEvent,
    Field(
        description="data of the SSE events a chapter or beat writing job sends between the lifecycle ones (§16); the SSE event name is the type.",
        title="ChapterJobEvent",
    ),
]
