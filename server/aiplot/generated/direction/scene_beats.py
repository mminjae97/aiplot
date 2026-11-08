# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from ..common import technique_id
from . import beat_density, beat_focus, beat_mode


class BeatEdit(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    summary: Annotated[StrictStr, Field(pattern="\\S")]
    techniques: list[technique_id.TechniqueId]
    pov: Annotated[StrictStr, Field(pattern="\\S")]
    mode: beat_mode.BeatMode
    focus: beat_focus.BeatFocus
    density: beat_density.BeatDensity
    tension: Annotated[StrictInt, Field(ge=1, le=5)]
    target_chars: Annotated[
        StrictInt,
        Field(
            description="A weight: the server rescales the beats' to sum to the scene's target.",
            ge=1,
        ),
    ]


class SceneBeatsUpdate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    beats: Annotated[list[BeatEdit], Field(min_length=1)]
