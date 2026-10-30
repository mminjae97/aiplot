# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictStr


class WorkCreate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    title: Annotated[
        StrictStr,
        Field(
            description="Raw input: the server collapses whitespace, then requires 1..100 chars (TITLE_EMPTY, TITLE_TOO_LONG).",
            max_length=1000,
        ),
    ]
