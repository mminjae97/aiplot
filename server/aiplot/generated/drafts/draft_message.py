# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictStr

from ..common import card_id


class DraftMessage(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    text: Annotated[StrictStr, Field(max_length=4000)]
    refs: Annotated[
        list[card_id.CardId] | None,
        Field(
            description="Cards the user @-mentioned in this turn; they stay in the draft's context.",
            max_length=20,
        ),
    ] = None
