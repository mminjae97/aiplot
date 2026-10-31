# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictStr

from ..common import cover_id as cover_id_1
from . import work


class WorkUpdate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    title: Annotated[
        StrictStr | None,
        Field(
            description="Raw input, checked like POST /works: whitespace collapsed, then 1..100 chars (TITLE_EMPTY, TITLE_TOO_LONG).",
            max_length=1000,
        ),
    ] = None
    color: work.Color | None = None
    cover_id: Annotated[
        cover_id_1.CoverId | None,
        Field(
            description="One of this book's covers (404 COVER_NOT_FOUND otherwise); null = cloth cover in the book colour."
        ),
    ] = None
