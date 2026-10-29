# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field


class StructureStage(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: Literal["발단", "전개", "위기", "절정", "결말", "기", "승", "전", "결"]
    summary: str | None
    tension: Annotated[int | None, Field(ge=1, le=5)]


class StoryStructure(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal[4, 5]
    stages: list[StructureStage]
