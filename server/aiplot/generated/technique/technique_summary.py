# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictStr

from ..common import technique_id
from . import technique_category, technique_effect, technique_scope, technique_situation


class TechniqueSummary(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: technique_id.TechniqueId
    category: technique_category.TechniqueCategory
    name: Annotated[StrictStr, Field(min_length=1)]
    name_en: Annotated[StrictStr, Field(min_length=1)]
    scope: list[technique_scope.TechniqueScope]
    effects: list[technique_effect.TechniqueEffect]
    situations: list[technique_situation.TechniqueSituation]
    description: Annotated[StrictStr, Field(min_length=1)]
