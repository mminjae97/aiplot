# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from ..common import technique_id
from ..direction import beat_density, beat_focus, beat_mode


class DirectBeat(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    summary: Annotated[
        StrictStr,
        Field(description="What happens in the beat, one or two sentences.", min_length=1),
    ]
    techniques: Annotated[
        list[technique_id.TechniqueId],
        Field(
            description="Cards the beat realizes, among the scene's chosen and serial cards (narrowed per call)."
        ),
    ]
    pov: Annotated[StrictStr, Field(min_length=1)]
    mode: beat_mode.BeatMode
    focus: beat_focus.BeatFocus
    density: beat_density.BeatDensity
    tension: Annotated[StrictInt, Field(ge=1, le=5)]
    target_chars: Annotated[
        StrictInt,
        Field(
            description="The beat's share of the scene in characters (a proportion: the server rescales).",
            ge=1,
        ),
    ]


class DirectOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    beats: Annotated[list[DirectBeat], Field(min_length=1)]
