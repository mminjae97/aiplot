# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictStr

from ..common import card_id


class CardDeleted(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    deleted: Annotated[list[card_id.CardId], Field(min_length=1)]
    restore_until: Annotated[
        StrictStr, Field(description="ISO 8601 UTC; about 10 s after the delete.")
    ]
