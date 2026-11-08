# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictInt

type PlanSceneNumber = Annotated[StrictInt, Field(ge=1, title="PlanSceneNumber")]


class PlanUpdate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    chapters: list[list[PlanSceneNumber]]
