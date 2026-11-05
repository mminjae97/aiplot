# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr

from ..technique import technique_effect, technique_situation


class SceneDevices(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    knowledge_gap: StrictBool
    hidden_secret: StrictBool
    mystery: StrictBool
    reveal: StrictBool
    reversal: StrictBool
    plant: StrictBool
    payoff: StrictBool
    foretold: StrictBool
    deadline: StrictBool
    dilemma: StrictBool
    eerie_threat: StrictBool
    action: StrictBool
    held_moment: StrictBool
    past_told: StrictBool
    embedded: StrictBool
    time_skip: StrictBool
    revisit: StrictBool
    repetition: StrictBool
    unspoken: StrictBool
    verbal_clash: StrictBool
    misunderstanding: StrictBool
    overhear: StrictBool
    crowd_voice: StrictBool
    first_appearance: StrictBool
    realization: StrictBool
    confession: StrictBool
    delayed_outcome: StrictBool
    relationship_shift: StrictBool
    humor: StrictBool
    satire: StrictBool
    new_place: StrictBool
    world_rules: StrictBool
    simultaneous: StrictBool
    ordinary_life: StrictBool
    aftermath: StrictBool
    contrast: StrictBool
    loss: StrictBool
    meaningful_object: StrictBool
    differing_views: StrictBool
    threshold: StrictBool
    release: StrictBool


class OutputScene(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    scene: Annotated[StrictInt, Field(ge=1)]
    source: Annotated[
        StrictStr,
        Field(
            description="The episode structure stage the scene comes from (§9 `source` = episode.stage).",
            min_length=1,
        ),
    ]
    summary: Annotated[
        StrictStr,
        Field(description="What happens, in one or two sentences.", min_length=1),
    ]
    devices: Annotated[
        SceneDevices,
        Field(
            description="A yes/no answer per scene device (technique-device.json, same keys in the same order), answered before the tags; code recommends the cards sharing the devices answered true (§9).",
            title="SceneDevices",
        ),
    ]
    effects: Annotated[
        list[technique_effect.TechniqueEffect],
        Field(
            description="Effects the scene wants the reader to feel.",
            max_length=3,
            min_length=1,
        ),
    ]
    situations: Annotated[
        list[technique_situation.TechniqueSituation],
        Field(description="Situations the scene is in.", max_length=3, min_length=1),
    ]


class SceneOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    scenes: Annotated[list[OutputScene], Field(min_length=1)]
