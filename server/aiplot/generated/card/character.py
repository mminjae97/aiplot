# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictStr

from ..common import card_id


class CharacterBehavior(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    situation: StrictStr
    action: StrictStr


class CharacterPersonality(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    traits: list[StrictStr]
    behaviors: list[CharacterBehavior]


class CharacterSpeech(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    description: StrictStr | None
    examples: Annotated[list[StrictStr], Field(max_length=5)]


class CharacterAppearance(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    summary: StrictStr | None
    details: StrictStr | None


class CharacterRelation(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    target_id: card_id.CardId
    relation: StrictStr


class CharacterData(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    theme: StrictStr | None
    personality: Annotated[CharacterPersonality, Field(title="CharacterPersonality")]
    speech: Annotated[CharacterSpeech, Field(title="CharacterSpeech")]
    appearance: Annotated[CharacterAppearance, Field(title="CharacterAppearance")]
    relations: list[CharacterRelation]
    origin_region_id: card_id.CardId | None
