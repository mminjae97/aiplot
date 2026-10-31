# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictStr

type PinnedItem = Annotated[StrictStr, Field(max_length=100, min_length=1)]


class DraftGenerate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    pinned: Annotated[list[PinnedItem] | None, Field(max_length=50)] = None
    structure: Literal[4, 5] | None = None
