# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from ..common import technique_id


class OutputPick(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    rank: Annotated[StrictInt, Field(description="1 = the best fit.", ge=1, le=3)]
    techniques: Annotated[
        list[technique_id.TechniqueId],
        Field(
            description="The combination: 1-3 candidate technique ids used together.",
            max_length=3,
            min_length=1,
        ),
    ]
    reason: Annotated[
        StrictStr,
        Field(
            description="Why this combination fits the scene, for the user.",
            min_length=1,
        ),
    ]


class PickOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    picks: Annotated[list[OutputPick], Field(max_length=3, min_length=1)]
