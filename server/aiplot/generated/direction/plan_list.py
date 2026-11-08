# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from . import plan_record


class PlanList(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    plans: Annotated[list[plan_record.PlanRecord], Field(max_length=1)]
