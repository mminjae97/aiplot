# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from ..common import card_id
from ..common import work_id as work_id_1
from . import character, episode, main_story, part, region, region_position

type CardName = Annotated[StrictStr | None, Field(title="CardName")]


type CardStatus = Annotated[
    Literal["complete", "incomplete"],
    Field(
        description="incomplete = any §15 required field missing; computed by the server.",
        title="CardStatus",
    ),
]


type SourceNotes = Annotated[StrictStr, Field(title="SourceNotes")]


type CardEvidenceItem = Annotated[StrictInt, Field(ge=0)]


type CardEvidence = dict[str, list[CardEvidenceItem]]


type AiGuessField = Annotated[StrictStr, Field(min_length=1)]


type AiGuessFields = Annotated[
    list[AiGuessField],
    Field(
        description="Field paths filled without evidence (shown as AI 추정).",
        title="AiGuessFields",
    ),
]


type PinnedField = Annotated[StrictStr, Field(min_length=1)]


type PinnedFields = Annotated[
    list[PinnedField],
    Field(description="Field paths kept across regeneration.", title="PinnedFields"),
]


type SchemaVersion = Annotated[StrictInt, Field(ge=1, title="SchemaVersion")]


class CharacterCard(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: card_id.CardId
    work_id: work_id_1.WorkId
    type: Literal["character"]
    name: CardName
    status: CardStatus
    source_notes: SourceNotes
    data: character.CharacterData
    evidence: CardEvidence
    ai_guess: AiGuessFields
    pinned: PinnedFields
    schema_version: SchemaVersion


class RegionCard(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: card_id.CardId
    work_id: work_id_1.WorkId
    type: Literal["region"]
    name: CardName
    status: CardStatus
    source_notes: SourceNotes
    data: region.RegionData
    evidence: CardEvidence
    ai_guess: AiGuessFields
    pinned: PinnedFields
    schema_version: SchemaVersion
    position: region_position.RegionPosition | None


class MainStoryCard(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: card_id.CardId
    work_id: work_id_1.WorkId
    type: Literal["main_story"]
    name: CardName
    status: CardStatus
    source_notes: SourceNotes
    data: main_story.MainStoryData
    evidence: CardEvidence
    ai_guess: AiGuessFields
    pinned: PinnedFields
    schema_version: SchemaVersion


class PartCard(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: card_id.CardId
    work_id: work_id_1.WorkId
    type: Literal["part"]
    name: CardName
    status: CardStatus
    source_notes: SourceNotes
    data: part.PartData
    evidence: CardEvidence
    ai_guess: AiGuessFields
    pinned: PinnedFields
    schema_version: SchemaVersion


class EpisodeCard(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: card_id.CardId
    work_id: work_id_1.WorkId
    type: Literal["episode"]
    name: CardName
    status: CardStatus
    source_notes: SourceNotes
    data: episode.EpisodeData
    evidence: CardEvidence
    ai_guess: AiGuessFields
    pinned: PinnedFields
    schema_version: SchemaVersion


type Card = Annotated[
    CharacterCard | RegionCard | MainStoryCard | PartCard | EpisodeCard,
    Field(
        description="Saved card (§15), discriminated by type. Card fields are never edited directly (§6).",
        discriminator="type",
        title="Card",
    ),
]
