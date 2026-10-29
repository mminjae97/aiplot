# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from ..common import card_id


class CharacterBehavior(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    situation: str
    action: str


class CharacterPersonality(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    traits: list[str]
    behaviors: list[CharacterBehavior]


class CharacterSpeech(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    description: str | None
    examples: Annotated[list[str], Field(max_length=5)]


class CharacterAppearance(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    summary: str | None
    details: str | None


class CharacterRelation(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    target_id: Annotated[str, Field(pattern="^c_[0-9A-Za-z]+$", title="CardId")]
    relation: str


class CharacterData(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    theme: str | None
    personality: Annotated[CharacterPersonality, Field(title="CharacterPersonality")]
    speech: Annotated[CharacterSpeech, Field(title="CharacterSpeech")]
    appearance: Annotated[CharacterAppearance, Field(title="CharacterAppearance")]
    relations: list[CharacterRelation]
    origin_region_id: card_id.CardId | None
