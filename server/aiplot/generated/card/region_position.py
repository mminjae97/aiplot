# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictFloat


class RegionPosition(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    map_x: Annotated[
        StrictFloat,
        Field(
            description="Finite map units (no NaN or Infinity).",
            ge=-1000000000.0,
            le=1000000000.0,
        ),
    ]
    map_y: Annotated[
        StrictFloat,
        Field(
            description="Finite map units (no NaN or Infinity).",
            ge=-1000000000.0,
            le=1000000000.0,
        ),
    ]
