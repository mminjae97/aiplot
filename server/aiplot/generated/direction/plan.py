# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from ..common import card_id, technique_id
from ..technique import technique_device, technique_effect, technique_situation
from . import beat_density, beat_focus, beat_mode, scene_status

type RevealItem = Annotated[StrictStr, Field(min_length=1)]


class PlanRecommendation(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    rank: Annotated[StrictInt, Field(ge=1)]
    technique: technique_id.TechniqueId
    devices: list[technique_device.TechniqueDevice]
    effects: list[technique_effect.TechniqueEffect]
    situations: list[technique_situation.TechniqueSituation]


class PlanBeat(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    order: Annotated[
        StrictInt, Field(description="1..n within the scene, set by the server.", ge=1)
    ]
    summary: Annotated[
        StrictStr,
        Field(
            description="What happens in the beat (the write role's instruction).",
            min_length=1,
        ),
    ]
    techniques: Annotated[
        list[technique_id.TechniqueId],
        Field(description="The scene's chosen or serial cards this beat realizes."),
    ]
    pov: Annotated[
        StrictStr,
        Field(description="Point of view, e.g. 테오 1인칭, 3인칭 관찰.", min_length=1),
    ]
    mode: beat_mode.BeatMode
    focus: beat_focus.BeatFocus
    density: beat_density.BeatDensity
    tension: Annotated[StrictInt, Field(ge=1, le=5)]
    target_chars: Annotated[
        StrictInt,
        Field(
            description="Characters incl. spaces, set by the server from the model's proportions.",
            ge=1,
        ),
    ]


class PlanScene(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    scene: Annotated[
        StrictInt,
        Field(description="Story-order number from the `scene` role (1..n).", ge=1),
    ]
    status: scene_status.SceneStatus
    source: Annotated[
        StrictStr,
        Field(
            description="The episode structure stage the scene comes from.",
            min_length=1,
        ),
    ]
    summary: Annotated[StrictStr, Field(min_length=1)]
    core: Annotated[
        StrictStr,
        Field(
            description="What the scene must give the reader, one sentence.",
            min_length=1,
        ),
    ]
    target_chars: Annotated[
        StrictInt,
        Field(
            description="Characters incl. spaces; the scene's beat targets sum to it.",
            ge=1,
        ),
    ]
    ai_devices: Annotated[
        list[technique_device.TechniqueDevice],
        Field(description="The devices the scene role answered main (pre-checked for the user)."),
    ]
    sub_devices: Annotated[
        list[technique_device.TechniqueDevice],
        Field(description="The devices the scene role answered sub (first among the unchecked)."),
    ]
    devices: Annotated[
        list[technique_device.TechniqueDevice],
        Field(
            description="The user's checked devices (ai_devices until corrected); the recommendation uses them."
        ),
    ]
    effects: Annotated[list[technique_effect.TechniqueEffect], Field(max_length=3)]
    situations: Annotated[list[technique_situation.TechniqueSituation], Field(max_length=3)]
    recommended: Annotated[
        list[PlanRecommendation],
        Field(
            description="The scene's recommended cards in rank order with what they share with it.",
            max_length=5,
        ),
    ]
    chosen: Annotated[
        list[technique_id.TechniqueId],
        Field(
            description="The user's cards for the scene (1-3 to direct it; empty before the pick).",
            max_length=3,
        ),
    ]
    reveal: Annotated[
        list[RevealItem],
        Field(
            description="What the scene reveals to the reader (from `arrange`), possibly nothing."
        ),
    ]
    beats: Annotated[
        list[PlanBeat],
        Field(description="In narration order; empty until the scene is directed."),
    ]


class PlanChapter(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    chapter: Annotated[
        StrictInt,
        Field(
            description="1..n within the episode; the chapter is cut after its last scene.",
            ge=1,
        ),
    ]
    target_chars: Annotated[
        StrictInt,
        Field(
            description="Characters incl. spaces; the chapter's scene targets sum to it.",
            ge=1,
        ),
    ]
    scenes: Annotated[list[PlanScene], Field(description="In narration order.", min_length=1)]


class DirectionPlan(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    episode: card_id.CardId
    chapters: Annotated[list[PlanChapter], Field(max_length=5, min_length=1)]
