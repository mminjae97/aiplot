# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr

from ..common import beat_id, card_id, chapter_id, technique_id
from ..common import plan_id as plan_id_1
from ..direction import beat_density, beat_focus, beat_mode


class ChapterBeat(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: beat_id.BeatId
    order: Annotated[StrictInt, Field(description="1..n within the chapter.", ge=1)]
    scene: Annotated[
        StrictInt,
        Field(
            description="The plan scene the beat belongs to (its story-order number).",
            ge=1,
        ),
    ]
    source_stage: Annotated[
        StrictStr,
        Field(
            description="The episode structure stage the beat's scene comes from.",
            min_length=1,
        ),
    ]
    summary: Annotated[
        StrictStr,
        Field(
            description="What happens in the beat (the write role's instruction).",
            min_length=1,
        ),
    ]
    techniques: list[technique_id.TechniqueId]
    pov: Annotated[StrictStr, Field(min_length=1)]
    mode: beat_mode.BeatMode
    focus: beat_focus.BeatFocus
    density: beat_density.BeatDensity
    tension: Annotated[StrictInt, Field(ge=1, le=5)]
    target_chars: Annotated[
        StrictInt, Field(description="Characters incl. spaces, from the plan.", ge=1)
    ]
    version: Annotated[
        StrictInt | None,
        Field(
            description="The current version's number; null until the beat is written.",
            ge=1,
        ),
    ]
    chars: Annotated[
        StrictInt | None,
        Field(
            description="The current version's characters incl. spaces; null until written.",
            ge=0,
        ),
    ]


class Chapter(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: chapter_id.ChapterId
    plan_id: plan_id_1.PlanId
    episode_id: card_id.CardId
    number: Annotated[
        StrictInt,
        Field(description="1..n within the work, in story order of the episodes.", ge=1),
    ]
    target_chars: Annotated[
        StrictInt,
        Field(
            description="Characters incl. spaces; the chapter's beat targets sum to it.",
            ge=1,
        ),
    ]
    read: StrictBool
    chars: Annotated[
        StrictInt,
        Field(
            description="Characters incl. spaces written so far (the beats' current versions).",
            ge=0,
        ),
    ]
    beats: Annotated[list[ChapterBeat], Field(description="In narration order.")]
