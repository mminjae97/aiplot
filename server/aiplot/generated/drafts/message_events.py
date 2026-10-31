# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from ..roles import source_output


class DraftReplyEvent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    text: StrictStr


type ChangedItem = Annotated[StrictInt, Field(ge=0)]


class DraftErrorEvent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    code: Annotated[StrictStr, Field(pattern="^[A-Z][A-Z0-9_]*$")]
    message: StrictStr


class DraftDoneEvent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )


class DraftSourceEvent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    notes: StrictStr
    sentences: list[StrictStr]
    changed: list[ChangedItem]
    questions: Annotated[list[StrictStr], Field(max_length=3)]
    similar_names: list[source_output.SimilarName]


type DraftMessageEvent = Annotated[
    DraftReplyEvent | DraftSourceEvent | DraftErrorEvent | DraftDoneEvent,
    Field(
        description="data of the SSE events of POST /drafts/{draftId}/messages; the SSE event name is the type. Order: reply* then source (unless the turn was the AI's opening), or error; always done last.",
        title="DraftMessageEvent",
    ),
]
