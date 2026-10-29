# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictStr

from ..common import card_id as card_id_1


class SimilarName(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    mentioned: Annotated[StrictStr, Field(min_length=1)]
    similar_to: Annotated[StrictStr, Field(min_length=1)]
    card_id: Annotated[
        card_id_1.CardId | None,
        Field(description="Existing card named similar_to, or null if it is only in the notes."),
    ]


class SourceOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    notes: Annotated[
        StrictStr,
        Field(
            description="Full rewritten source notes; reversals resolved. Server rejects an empty result when previous notes were non-empty."
        ),
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
            description="Pairs of names that may be one entity spelled differently (레오/래오), within the notes or against existing cards."
        ),
    ]
