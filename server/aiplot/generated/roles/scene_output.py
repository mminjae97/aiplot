# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from ..technique import technique_effect, technique_situation

type DeviceRole = Annotated[
    Literal["main", "sub", "none"],
    Field(
        description="How a scene device figures in the scene (scene v5): main = it carries the scene's core (the recommendation uses these), sub = present but incidental, none = absent, merely possible or another scene's.",
        title="DeviceRole",
    ),
]


class SceneDevices(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    knowledge_gap: DeviceRole
    hidden_secret: DeviceRole
    mystery: DeviceRole
    reveal: DeviceRole
    reversal: DeviceRole
    plant: DeviceRole
    payoff: DeviceRole
    foretold: DeviceRole
    deadline: DeviceRole
    dilemma: DeviceRole
    eerie_threat: DeviceRole
    action: DeviceRole
    held_moment: DeviceRole
    past_told: DeviceRole
    embedded: DeviceRole
    time_skip: DeviceRole
    revisit: DeviceRole
    repetition: DeviceRole
    unspoken: DeviceRole
    verbal_clash: DeviceRole
    misunderstanding: DeviceRole
    overhear: DeviceRole
    crowd_voice: DeviceRole
    first_appearance: DeviceRole
    realization: DeviceRole
    confession: DeviceRole
    delayed_outcome: DeviceRole
    relationship_shift: DeviceRole
    humor: DeviceRole
    satire: DeviceRole
    new_place: DeviceRole
    world_rules: DeviceRole
    simultaneous: DeviceRole
    ordinary_life: DeviceRole
    aftermath: DeviceRole
    contrast: DeviceRole
    loss: DeviceRole
    meaningful_object: DeviceRole
    differing_views: DeviceRole
    threshold: DeviceRole
    release: DeviceRole


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
    core: Annotated[
        StrictStr,
        Field(
            description="Why the scene is in the episode, in one sentence: what it must give the reader (scene v5); written before the devices, which are answered against it.",
            min_length=1,
        ),
    ]
    devices: Annotated[
        SceneDevices,
        Field(
            description="An answer per scene device (technique-device.json, same keys in the same order), main, sub or none, after the core and before the tags; code recommends the cards sharing the main devices (§9).",
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
