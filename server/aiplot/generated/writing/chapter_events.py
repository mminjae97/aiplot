# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from ..common import beat_id, card_id, warning_id
from . import state_key, state_value, warning_kind


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


class BeatCheckedEvent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    beatId: beat_id.BeatId
    warnings: Annotated[StrictInt, Field(ge=0)]


class WarningEvent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    warningId: warning_id.WarningId
    beatId: beat_id.BeatId
    kind: warning_kind.WarningKind


class StateUpdateEvent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    cardId: card_id.CardId
    key: state_key.StateKey
    value: state_value.StateValue


type ChapterJobEvent = Annotated[
    BeatStartEvent
    | SentenceEvent
    | BeatDoneEvent
    | StateUpdateEvent
    | WarningEvent
    | BeatCheckedEvent,
    Field(
        description="data of the SSE events a chapter or beat writing job sends between the lifecycle ones (§16); the SSE event name is the type.",
        title="ChapterJobEvent",
    ),
]
