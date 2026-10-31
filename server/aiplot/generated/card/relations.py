# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictStr

from ..common import card_id


class CardRelation(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    from_id: card_id.CardId
    to_id: card_id.CardId
    relation: Annotated[
        StrictStr | None,
        Field(
            description="The relation text (character), 'main' for an episode's main region; otherwise null."
        ),
    ]


class CardRelations(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    relations: list[CardRelation]
