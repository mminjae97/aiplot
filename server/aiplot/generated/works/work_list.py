# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from . import work


class WorkList(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    works: list[work.Work]
