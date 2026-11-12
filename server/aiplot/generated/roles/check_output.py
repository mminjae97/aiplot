# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr

from ..writing import injury_severity, item_action

type CheckKind = Annotated[
    Literal["character", "appearance", "travel", "state", "world_rule"],
    Field(title="CheckKind"),
]


class CheckWarning(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Annotated[CheckKind, Field(title="CheckKind")]
    sentence: Annotated[
        StrictInt,
        Field(description="The [n] number of the beat sentence it is about.", ge=1),
    ]
    card: Annotated[
        StrictStr | None,
        Field(
            description="The name of the card it is judged against (narrowed per call to the cards shown), null when none."
        ),
    ]
    reason: Annotated[
        StrictStr,
        Field(description="What contradicts what, one sentence.", min_length=1),
    ]


class LocationChange(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    key: Literal["location"]
    card: Annotated[
        StrictStr,
        Field(
            description="The character's name as in <참고 카드> (narrowed per call to the episode's characters).",
            min_length=1,
        ),
    ]
    region: Annotated[
        StrictStr,
        Field(
            description="The region's name (narrowed per call to the work's regions).",
            min_length=1,
        ),
    ]


class SecretChange(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    key: Literal["knows_secret"]
    card: Annotated[
        StrictStr,
        Field(
            description="The character's name as in <참고 카드> (narrowed per call to the episode's characters).",
            min_length=1,
        ),
    ]
    secret: Annotated[StrictStr, Field(min_length=1)]


class RelationChange(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    key: Literal["relation_change"]
    card: Annotated[
        StrictStr,
        Field(
            description="The character's name as in <참고 카드> (narrowed per call to the episode's characters).",
            min_length=1,
        ),
    ]
    target: Annotated[
        StrictStr,
        Field(description="The other character's name (narrowed per call).", min_length=1),
    ]
    change: Annotated[StrictStr, Field(min_length=1)]


class AppearanceChange(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    key: Literal["appearance_change"]
    card: Annotated[
        StrictStr,
        Field(
            description="The character's name as in <참고 카드> (narrowed per call to the episode's characters).",
            min_length=1,
        ),
    ]
    text: Annotated[StrictStr, Field(min_length=1)]


class InjuryChange(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    key: Literal["injury"]
    card: Annotated[
        StrictStr,
        Field(
            description="The character's name as in <참고 카드> (narrowed per call to the episode's characters).",
            min_length=1,
        ),
    ]
    part: Annotated[StrictStr, Field(min_length=1)]
    severity: injury_severity.InjurySeverity
    healed: StrictBool


class ItemChange(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    key: Literal["item"]
    card: Annotated[
        StrictStr,
        Field(
            description="The character's name as in <참고 카드> (narrowed per call to the episode's characters).",
            min_length=1,
        ),
    ]
    name: Annotated[StrictStr, Field(min_length=1)]
    action: item_action.ItemAction


type StateChange = Annotated[
    LocationChange | InjuryChange | ItemChange | SecretChange | RelationChange | AppearanceChange,
    Field(discriminator="key", title="StateChange"),
]


class CheckOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    state: list[StateChange]
    warnings: list[CheckWarning]
