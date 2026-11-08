# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictInt

type Chapter = Annotated[StrictInt, Field(ge=1)]


class PlanUpdate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    chapters: list[list[Chapter]]
