# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, StrictFloat


class RegionPosition(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    map_x: StrictFloat
    map_y: StrictFloat
