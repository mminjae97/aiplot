# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from ..technique import technique_effect, technique_situation


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
    effects: Annotated[
        list[technique_effect.TechniqueEffect],
        Field(description="Effects the scene wants the reader to feel.", max_length=3),
    ]
    situations: Annotated[
        list[technique_situation.TechniqueSituation],
        Field(description="Situations the scene is in.", max_length=3),
    ]


class SceneOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    scenes: Annotated[list[OutputScene], Field(min_length=1)]
