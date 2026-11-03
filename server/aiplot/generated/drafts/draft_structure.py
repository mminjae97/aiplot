# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class DraftStructure(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal[4]
