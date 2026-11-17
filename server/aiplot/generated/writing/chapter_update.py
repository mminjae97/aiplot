# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictFloat


class ChapterUpdate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    read: Annotated[
        StrictBool | None,
        Field(description="읽음: set at the chapter's end, or toggled in the list."),
    ] = None
    position: Annotated[
        StrictFloat | None,
        Field(
            description="Where the reader stopped: the share of the text scrolled past, 0 = its start.",
            ge=0.0,
            le=1.0,
        ),
    ] = None
