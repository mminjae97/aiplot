# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from ..common import beat_id, chapter_id
from . import version_origin


class BeatText(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: beat_id.BeatId
    order: Annotated[StrictInt, Field(ge=1)]
    version: Annotated[StrictInt | None, Field(ge=1)]
    chars: Annotated[StrictInt | None, Field(ge=0)]
    origin: version_origin.VersionOrigin | None
    text: StrictStr | None


class ChapterText(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: chapter_id.ChapterId
    number: Annotated[StrictInt, Field(ge=1)]
    beats: Annotated[list[BeatText], Field(description="In narration order.")]
