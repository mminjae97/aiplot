# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr

from ..common import beat_id, chapter_id
from . import version_origin


class SentenceSpan(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    start: Annotated[StrictInt, Field(ge=0)]
    end: Annotated[StrictInt, Field(ge=1)]


class BeatText(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: beat_id.BeatId
    order: Annotated[StrictInt, Field(ge=1)]
    version: Annotated[StrictInt | None, Field(ge=1)]
    chars: Annotated[StrictInt | None, Field(ge=0)]
    origin: version_origin.VersionOrigin | None
    checked: Annotated[
        StrictBool | None,
        Field(description="Whether the current version's check is over."),
    ]
    text: StrictStr | None
    sentences: Annotated[
        list[SentenceSpan] | None,
        Field(
            description="The text's sentences as the server splits them (§15 Sentences; a warning's sentence n is the n-th): start and end offsets in Unicode code points, end exclusive. Null while unwritten."
        ),
    ]


class ChapterText(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: chapter_id.ChapterId
    number: Annotated[StrictInt, Field(ge=1)]
    beats: Annotated[list[BeatText], Field(description="In narration order.")]
