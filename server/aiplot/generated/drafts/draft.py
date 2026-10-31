# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictStr

from ..common import card_id as card_id_1
from ..common import draft_id
from ..common import work_id as work_id_1
from ..roles import card_output


class DraftTurn(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    role: Literal["user", "ai"]
    text: StrictStr


type PinnedItem = Annotated[StrictStr, Field(min_length=1)]


class Draft(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: draft_id.DraftId
    work_id: work_id_1.WorkId
    type: Literal["world", "character", "region", "main_story", "part", "episode"]
    card_id: Annotated[
        card_id_1.CardId | None,
        Field(description="The card being edited; null for a new card."),
    ]
    category: Literal["rule", "faction", "history", "culture", "other"] | None
    part_id: card_id_1.CardId | None
    notes: Annotated[
        StrictStr,
        Field(description="Source notes as the user and the source role left them."),
    ]
    sentences: Annotated[
        list[StrictStr],
        Field(
            description="notes split by the server (§15); evidence, highlights and changed sentences use these 0-based indexes."
        ),
    ]
    turns: Annotated[list[DraftTurn], Field(description="The conversation so far (memory only).")]
    pinned: Annotated[
        list[PinnedItem],
        Field(description="Field paths kept from the saved card when the card is generated again."),
    ]
    generated: Annotated[
        card_output.CardOutput | None,
        Field(description="The last generated card, not saved yet; null before 카드 생성."),
    ]
