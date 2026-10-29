# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from ..common import milestone_id


class Milestone(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: milestone_id.MilestoneId
    order: Annotated[StrictInt, Field(ge=1)]
    text: StrictStr


class MainStoryData(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    theme: StrictStr | None
    premise: StrictStr | None
    ending: StrictStr | None
    milestones: list[Milestone]
