# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr

from ..common import card_id
from . import injury_severity, item_action


class LocationState(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    region_id: card_id.CardId


class InjuryState(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    part: Annotated[StrictStr, Field(min_length=1)]
    severity: injury_severity.InjurySeverity
    since_chapter: Annotated[
        StrictInt,
        Field(description="The chapter number it dates from (set by the server).", ge=1),
    ]
    healed: StrictBool


class ItemState(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: Annotated[StrictStr, Field(min_length=1)]
    action: item_action.ItemAction


class SecretState(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    secret: Annotated[StrictStr, Field(min_length=1)]
    since_chapter: Annotated[
        StrictInt,
        Field(
            description="The chapter number the character learned it in (set by the server).",
            ge=1,
        ),
    ]


class RelationState(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    target_id: card_id.CardId
    change: Annotated[StrictStr, Field(min_length=1)]


class AppearanceState(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    text: Annotated[StrictStr, Field(min_length=1)]


type StateValue = Annotated[
    LocationState | InjuryState | ItemState | SecretState | RelationState | AppearanceState,
    Field(
        description="A state record's value (§7), by its key: one character's state as a beat left it. A later beat's context holds the latest per character, key and subject (the item's name, the secret, the injured part, the other character; one location and one appearance change per character), without items lost and injuries healed.",
        title="StateValue",
    ),
]
