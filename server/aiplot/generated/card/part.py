# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from ..common import milestone_id
from . import structure as structure_1


class PartData(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    order: Annotated[StrictInt | None, Field(ge=1)]
    title: StrictStr | None
    theme: StrictStr | None
    fulfills: list[milestone_id.MilestoneId]
    start: StrictStr | None
    end: StrictStr | None
    structure: structure_1.StoryStructure | None
