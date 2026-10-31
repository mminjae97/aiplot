# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictStr

from ..common import card_id as card_id_1


class CardReference(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    card_id: card_id_1.CardId
    type: Literal["world", "character", "region", "main_story", "part", "episode"]
    name: StrictStr | None
    field: Annotated[
        StrictStr,
        Field(
            description="Where the referencing card points at it, as a data path: relations, origin_region_id, parent_id, links, related, characters, locations.main, locations.others, world, links.prev, links.next, links.causes, part_id, fulfills, foreshadowing.payoffs."
        ),
    ]


class CardReferences(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    references: list[CardReference]
