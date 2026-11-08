# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from ..common import technique_id


class ScenePick(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    techniques: Annotated[list[technique_id.TechniqueId], Field(min_length=1)]
