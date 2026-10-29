# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr


class FourStage(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: Literal["기", "승", "전", "결"]
    summary: StrictStr | None
    tension: Annotated[StrictInt | None, Field(ge=1, le=5)]


class FiveStage(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: Literal["발단", "전개", "위기", "절정", "결말"]
    summary: StrictStr | None
    tension: Annotated[StrictInt | None, Field(ge=1, le=5)]


class FourStageStructure(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal[4]
    stages: Annotated[
        list[FourStage],
        Field(
            description="One entry per stage, in story order; names unique (checked by the server).",
            max_length=4,
            min_length=4,
        ),
    ]


class FiveStageStructure(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal[5]
    stages: Annotated[
        list[FiveStage],
        Field(
            description="One entry per stage, in story order; names unique (checked by the server).",
            max_length=5,
            min_length=5,
        ),
    ]


type StoryStructure = Annotated[
    FourStageStructure | FiveStageStructure,
    Field(
        description="Narrative structure (§7): 5-stage 발단·전개·위기·절정·결말 or 4-stage 기승전결.",
        title="StoryStructure",
    ),
]
