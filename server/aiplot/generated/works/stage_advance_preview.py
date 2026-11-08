# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from ..common import card_id as card_id_1

type PreviewCardType = Annotated[
    Literal["world", "character", "region", "main_story", "part", "episode"],
    Field(title="PreviewCardType"),
]


class ReferencingCard(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    card_id: card_id_1.CardId
    type: PreviewCardType
    name: StrictStr | None


class InactiveCard(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    card_id: card_id_1.CardId
    type: PreviewCardType
    name: StrictStr | None
    referenced_by: Annotated[
        list[ReferencingCard],
        Field(description="Complete cards pointing at it (relation tables), each once."),
    ]


class StageAdvancePreview(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    stage: Annotated[
        Literal[1, 2],
        Field(description="The current stage, the one the advance locks."),
    ]
    active_episodes: Annotated[StrictInt, Field(ge=0)]
    unconfirmed_episodes: Annotated[
        StrictInt,
        Field(
            description="Active episodes without a confirmed direction plan (stage 2 needs none).",
            ge=0,
        ),
    ]
    incomplete: list[InactiveCard]
