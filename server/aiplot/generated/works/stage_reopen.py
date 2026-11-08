# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, StrictStr


class StageReopen(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    stage: Literal[1, 2]
    title: StrictStr | None = None
