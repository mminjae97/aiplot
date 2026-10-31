# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from ..common import card_id as card_id_1
from ..common import foreshadowing_id, milestone_id


class IncompleteCard(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    card_id: card_id_1.CardId
    type: Literal["world", "character", "region", "main_story", "part", "episode"]
    name: StrictStr | None


class MilestoneFulfilment(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: milestone_id.MilestoneId
    order: Annotated[StrictInt, Field(ge=1)]
    text: StrictStr
    parts: list[card_id_1.CardId]
    episodes: list[card_id_1.CardId]


class ForeshadowingStatus(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: foreshadowing_id.ForeshadowingId
    text: StrictStr
    plant_episode_id: card_id_1.CardId
    payoff_episode_id: card_id_1.CardId | None


class Completeness(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    milestones: Annotated[
        list[MilestoneFulfilment],
        Field(
            description="Every milestone of the main story, in order, with the parts and episodes that fulfil it (each must be in exactly one part)."
        ),
    ]
    foreshadowing: Annotated[
        list[ForeshadowingStatus],
        Field(
            description="Every planted foreshadowing; payoff_episode_id null = not paid off yet."
        ),
    ]
    incomplete: Annotated[
        list[IncompleteCard],
        Field(description="Cards with a §15 required field missing."),
    ]
