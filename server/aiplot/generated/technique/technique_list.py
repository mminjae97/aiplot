# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from . import technique_summary


class TechniqueList(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    techniques: list[technique_summary.TechniqueSummary]
