# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from . import character, episode, main_story, part, region, region_position

type CardEvidenceItem = Annotated[int, Field(ge=0)]


type AiGuessField = Annotated[str, Field(min_length=1)]


type PinnedField = Annotated[str, Field(min_length=1)]


class CharacterCard(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Annotated[str, Field(pattern="^c_[0-9A-Za-z]+$", title="CardId")]
    work_id: Annotated[str, Field(pattern="^w_[0-9A-Za-z]+$", title="WorkId")]
    type: Literal["character"]
    name: Annotated[str | None, Field(title="CardName")]
    status: Annotated[
        Literal["complete", "incomplete"],
        Field(
            description="incomplete = any §15 required field missing; computed by the server.",
            title="CardStatus",
        ),
    ]
    source_notes: Annotated[str, Field(title="SourceNotes")]
    data: character.CharacterData
    evidence: dict[str, list[CardEvidenceItem]]
    ai_guess: Annotated[
        list[AiGuessField],
        Field(
            description="Field paths filled without evidence (shown as AI 추정).",
            title="AiGuessFields",
        ),
    ]
    pinned: Annotated[
        list[PinnedField],
        Field(description="Field paths kept across regeneration.", title="PinnedFields"),
    ]
    schema_version: Annotated[int, Field(ge=1, title="SchemaVersion")]


class RegionCard(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Annotated[str, Field(pattern="^c_[0-9A-Za-z]+$", title="CardId")]
    work_id: Annotated[str, Field(pattern="^w_[0-9A-Za-z]+$", title="WorkId")]
    type: Literal["region"]
    name: Annotated[str | None, Field(title="CardName")]
    status: Annotated[
        Literal["complete", "incomplete"],
        Field(
            description="incomplete = any §15 required field missing; computed by the server.",
            title="CardStatus",
        ),
    ]
    source_notes: Annotated[str, Field(title="SourceNotes")]
    data: region.RegionData
    evidence: dict[str, list[CardEvidenceItem]]
    ai_guess: Annotated[
        list[AiGuessField],
        Field(
            description="Field paths filled without evidence (shown as AI 추정).",
            title="AiGuessFields",
        ),
    ]
    pinned: Annotated[
        list[PinnedField],
        Field(description="Field paths kept across regeneration.", title="PinnedFields"),
    ]
    schema_version: Annotated[int, Field(ge=1, title="SchemaVersion")]
    position: region_position.RegionPosition | None


class MainStoryCard(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Annotated[str, Field(pattern="^c_[0-9A-Za-z]+$", title="CardId")]
    work_id: Annotated[str, Field(pattern="^w_[0-9A-Za-z]+$", title="WorkId")]
    type: Literal["main_story"]
    name: Annotated[str | None, Field(title="CardName")]
    status: Annotated[
        Literal["complete", "incomplete"],
        Field(
            description="incomplete = any §15 required field missing; computed by the server.",
            title="CardStatus",
        ),
    ]
    source_notes: Annotated[str, Field(title="SourceNotes")]
    data: main_story.MainStoryData
    evidence: dict[str, list[CardEvidenceItem]]
    ai_guess: Annotated[
        list[AiGuessField],
        Field(
            description="Field paths filled without evidence (shown as AI 추정).",
            title="AiGuessFields",
        ),
    ]
    pinned: Annotated[
        list[PinnedField],
        Field(description="Field paths kept across regeneration.", title="PinnedFields"),
    ]
    schema_version: Annotated[int, Field(ge=1, title="SchemaVersion")]


class PartCard(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Annotated[str, Field(pattern="^c_[0-9A-Za-z]+$", title="CardId")]
    work_id: Annotated[str, Field(pattern="^w_[0-9A-Za-z]+$", title="WorkId")]
    type: Literal["part"]
    name: Annotated[str | None, Field(title="CardName")]
    status: Annotated[
        Literal["complete", "incomplete"],
        Field(
            description="incomplete = any §15 required field missing; computed by the server.",
            title="CardStatus",
        ),
    ]
    source_notes: Annotated[str, Field(title="SourceNotes")]
    data: part.PartData
    evidence: dict[str, list[CardEvidenceItem]]
    ai_guess: Annotated[
        list[AiGuessField],
        Field(
            description="Field paths filled without evidence (shown as AI 추정).",
            title="AiGuessFields",
        ),
    ]
    pinned: Annotated[
        list[PinnedField],
        Field(description="Field paths kept across regeneration.", title="PinnedFields"),
    ]
    schema_version: Annotated[int, Field(ge=1, title="SchemaVersion")]


class EpisodeCard(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Annotated[str, Field(pattern="^c_[0-9A-Za-z]+$", title="CardId")]
    work_id: Annotated[str, Field(pattern="^w_[0-9A-Za-z]+$", title="WorkId")]
    type: Literal["episode"]
    name: Annotated[str | None, Field(title="CardName")]
    status: Annotated[
        Literal["complete", "incomplete"],
        Field(
            description="incomplete = any §15 required field missing; computed by the server.",
            title="CardStatus",
        ),
    ]
    source_notes: Annotated[str, Field(title="SourceNotes")]
    data: episode.EpisodeData
    evidence: dict[str, list[CardEvidenceItem]]
    ai_guess: Annotated[
        list[AiGuessField],
        Field(
            description="Field paths filled without evidence (shown as AI 추정).",
            title="AiGuessFields",
        ),
    ]
    pinned: Annotated[
        list[PinnedField],
        Field(description="Field paths kept across regeneration.", title="PinnedFields"),
    ]
    schema_version: Annotated[int, Field(ge=1, title="SchemaVersion")]


type Card = Annotated[
    CharacterCard | RegionCard | MainStoryCard | PartCard | EpisodeCard,
    Field(
        description="Saved card (§15), discriminated by type. Card fields are never edited directly (§6).",
        discriminator="type",
        title="Card",
    ),
]
