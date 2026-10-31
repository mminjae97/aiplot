# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from ..common import card_id as card_id_1


class DraftCreate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["world", "character", "region", "main_story", "part", "episode"]
    card_id: card_id_1.CardId | None = None
    category: Annotated[
        Literal["rule", "faction", "history", "culture", "other"] | None,
        Field(
            description="World book tab the new entry was started from: a hint for card generation, never asked in chat (§8)."
        ),
    ] = None
    part_id: Annotated[
        card_id_1.CardId | None,
        Field(
            description="New episode: the part selected on the story screen; the episode is placed last in it."
        ),
    ] = None
