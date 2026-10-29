# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from ..common import milestone_id
from . import structure as structure_1


class PartData(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    order: Annotated[int | None, Field(ge=1)]
    title: str | None
    theme: str | None
    fulfills: list[milestone_id.MilestoneId]
    start: str | None
    end: str | None
    structure: structure_1.StoryStructure | None
