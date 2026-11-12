# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from . import warning


class WarningList(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    warnings: list[warning.Warning]
