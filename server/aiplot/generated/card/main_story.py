# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field


class Milestone(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Annotated[str, Field(pattern="^ms_[0-9A-Za-z]+$", title="MilestoneId")]
    order: Annotated[int, Field(ge=1)]
    text: str


class MainStoryData(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    theme: str | None
    premise: str | None
    ending: str | None
    milestones: list[Milestone]
