# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr

from ..technique import technique_effect, technique_situation


class SceneChecks(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    knowledge_gap: Annotated[
        StrictBool,
        Field(description="The reader knows something a character does not."),
    ]
    hidden: Annotated[
        StrictBool,
        Field(
            description="A character hides something, or the reader is still kept from something."
        ),
    ]
    reveal: Annotated[
        StrictBool,
        Field(description="A hidden fact comes out or the reader's expectation is overturned."),
    ]
    payoff: Annotated[StrictBool, Field(description="Foreshadowing planted earlier is paid off.")]
    plant: Annotated[
        StrictBool, Field(description="A clue or an ominous sign is planted for later.")
    ]
    deadline: Annotated[StrictBool, Field(description="A set deadline or a danger drawing near.")]
    held_moment: Annotated[StrictBool, Field(description="One moment is drawn out at length.")]
    action: Annotated[StrictBool, Field(description="A fight or a chase.")]
    past_told: Annotated[StrictBool, Field(description="Past events are told or recalled.")]
    time_skip: Annotated[StrictBool, Field(description="Much time passes.")]
    revisit: Annotated[
        StrictBool,
        Field(description="A place is visited again or an earlier scene repeats."),
    ]
    unspoken: Annotated[
        StrictBool, Field(description="A character leaves a feeling or meaning unsaid.")
    ]
    relation: Annotated[
        StrictBool,
        Field(description="A relation between characters changes, or they clash in words."),
    ]
    humor: Annotated[StrictBool, Field(description="Something is funny.")]
    spectacle: Annotated[
        StrictBool, Field(description="An unfamiliar world or a vast sight is shown.")
    ]
    simultaneous: Annotated[
        StrictBool, Field(description="Something happens elsewhere at the same time.")
    ]
    breather: Annotated[StrictBool, Field(description="A pause between big events.")]


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
    checks: Annotated[
        SceneChecks,
        Field(
            description="Yes/no questions about the scene, answered before its tags; the server adds the tags of each question answered true (direction.CHECK_TAGS, §9).",
            title="SceneChecks",
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
