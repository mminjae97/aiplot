# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictStr

from ..common import card_id as card_id_1


class SimilarName(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    mentioned: StrictStr
    card_id: card_id_1.CardId


class SourceOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    notes: Annotated[
        StrictStr, Field(description="Full rewritten source notes; reversals resolved.")
    ]
    questions: Annotated[
        list[StrictStr],
        Field(
            description="Follow-up questions for missing or ambiguous information.",
            max_length=3,
        ),
    ]
    similar_names: Annotated[
        list[SimilarName],
        Field(
            description="Names in the notes that may be an existing card spelled differently (레오/래오)."
        ),
    ]
