# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from ..common import (
    card_id,
    foreshadowing_id,
    milestone_id,
)
from ..common import (
    worldline_id as worldline_id_1,
)
from . import structure as structure_1


class EpisodeLocations(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    main: card_id.CardId | None
    others: list[card_id.CardId]


class EpisodeLinks(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    prev: card_id.CardId | None
    next: card_id.CardId | None
    causes: list[card_id.CardId]


class ForeshadowingPlant(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: foreshadowing_id.ForeshadowingId
    text: StrictStr


class EpisodeForeshadowing(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    plants: list[ForeshadowingPlant]
    payoffs: Annotated[
        list[foreshadowing_id.ForeshadowingId],
        Field(description="Ids of foreshadowing planted in other episodes and paid off here."),
    ]


class EpisodeData(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    part_id: card_id.CardId | None
    order: Annotated[StrictInt | None, Field(ge=1)]
    theme: StrictStr | None
    relation_to_main: StrictStr | None
    fulfills: list[milestone_id.MilestoneId]
    characters: list[card_id.CardId]
    locations: Annotated[EpisodeLocations, Field(title="EpisodeLocations")]
    world: Annotated[
        list[card_id.CardId],
        Field(
            description="World cards this episode relies on (stage 2-3 context, world-rule check)."
        ),
    ]
    links: Annotated[EpisodeLinks, Field(title="EpisodeLinks")]
    foreshadowing: Annotated[EpisodeForeshadowing, Field(title="EpisodeForeshadowing")]
    worldline_id: worldline_id_1.WorldlineId | None
    structure: structure_1.StoryStructure | None
    synopsis: StrictStr | None
