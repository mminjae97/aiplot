# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from ..common import card_id as card_id_1

type Text = Annotated[StrictStr, Field(min_length=1)]


class SourceEdit(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    index: Annotated[StrictInt, Field(ge=0)]
    text: Text | None


type AddedItem = Annotated[StrictStr, Field(min_length=1)]


type Question = Annotated[StrictStr, Field(min_length=1)]


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
    edits: Annotated[
        list[SourceEdit],
        Field(
            description="Existing sentences this turn changes: text replaces sentence [index], null deletes it. The server drops out-of-range and repeated indexes."
        ),
    ]
    added: Annotated[
        list[AddedItem],
        Field(description="New sentences appended after the notes, in order."),
    ]
    questions: Annotated[
        list[Question],
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
