# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictStr


class DraftSource(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    notes: Annotated[StrictStr, Field(max_length=20000)]
