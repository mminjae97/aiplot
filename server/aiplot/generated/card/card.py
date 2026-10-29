# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel

from . import character, episode, main_story, part, region, region_position


class CharacterCard(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Annotated[str, Field(pattern="^c_[0-9A-Za-z]+$", title="CardId")]
    work_id: Annotated[str, Field(pattern="^w_[0-9A-Za-z]+$", title="WorkId")]
    type: Literal["character"]
    name: str | None
    status: Annotated[
        Literal["complete", "incomplete"],
        Field(
            description="incomplete = any §15 required field missing; computed by the server.",
            title="CardStatus",
        ),
    ]
    source_notes: str
    data: character.CharacterData
    evidence: dict[str, list[int]]
    ai_guess: Annotated[
        list[str],
        Field(description="Field paths filled without evidence (shown as AI 추정)."),
    ]
    pinned: Annotated[list[str], Field(description="Field paths kept across regeneration.")]
    schema_version: Annotated[int, Field(ge=1)]


class RegionCard(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Annotated[str, Field(pattern="^c_[0-9A-Za-z]+$", title="CardId")]
    work_id: Annotated[str, Field(pattern="^w_[0-9A-Za-z]+$", title="WorkId")]
    type: Literal["region"]
    name: str | None
    status: Annotated[
        Literal["complete", "incomplete"],
        Field(
            description="incomplete = any §15 required field missing; computed by the server.",
            title="CardStatus",
        ),
    ]
    source_notes: str
    data: region.RegionData
    evidence: dict[str, list[int]]
    ai_guess: Annotated[
        list[str],
        Field(description="Field paths filled without evidence (shown as AI 추정)."),
    ]
    pinned: Annotated[list[str], Field(description="Field paths kept across regeneration.")]
    schema_version: Annotated[int, Field(ge=1)]
    position: region_position.RegionPosition | None


class MainStoryCard(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Annotated[str, Field(pattern="^c_[0-9A-Za-z]+$", title="CardId")]
    work_id: Annotated[str, Field(pattern="^w_[0-9A-Za-z]+$", title="WorkId")]
    type: Literal["main_story"]
    name: str | None
    status: Annotated[
        Literal["complete", "incomplete"],
        Field(
            description="incomplete = any §15 required field missing; computed by the server.",
            title="CardStatus",
        ),
    ]
    source_notes: str
    data: main_story.MainStoryData
    evidence: dict[str, list[int]]
    ai_guess: Annotated[
        list[str],
        Field(description="Field paths filled without evidence (shown as AI 추정)."),
    ]
    pinned: Annotated[list[str], Field(description="Field paths kept across regeneration.")]
    schema_version: Annotated[int, Field(ge=1)]


class PartCard(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Annotated[str, Field(pattern="^c_[0-9A-Za-z]+$", title="CardId")]
    work_id: Annotated[str, Field(pattern="^w_[0-9A-Za-z]+$", title="WorkId")]
    type: Literal["part"]
    name: str | None
    status: Annotated[
        Literal["complete", "incomplete"],
        Field(
            description="incomplete = any §15 required field missing; computed by the server.",
            title="CardStatus",
        ),
    ]
    source_notes: str
    data: part.PartData
    evidence: dict[str, list[int]]
    ai_guess: Annotated[
        list[str],
        Field(description="Field paths filled without evidence (shown as AI 추정)."),
    ]
    pinned: Annotated[list[str], Field(description="Field paths kept across regeneration.")]
    schema_version: Annotated[int, Field(ge=1)]


class EpisodeCard(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Annotated[str, Field(pattern="^c_[0-9A-Za-z]+$", title="CardId")]
    work_id: Annotated[str, Field(pattern="^w_[0-9A-Za-z]+$", title="WorkId")]
    type: Literal["episode"]
    name: str | None
    status: Annotated[
        Literal["complete", "incomplete"],
        Field(
            description="incomplete = any §15 required field missing; computed by the server.",
            title="CardStatus",
        ),
    ]
    source_notes: str
    data: episode.EpisodeData
    evidence: dict[str, list[int]]
    ai_guess: Annotated[
        list[str],
        Field(description="Field paths filled without evidence (shown as AI 추정)."),
    ]
    pinned: Annotated[list[str], Field(description="Field paths kept across regeneration.")]
    schema_version: Annotated[int, Field(ge=1)]


class Card(RootModel[CharacterCard | RegionCard | MainStoryCard | PartCard | EpisodeCard]):
    root: Annotated[
        CharacterCard | RegionCard | MainStoryCard | PartCard | EpisodeCard,
        Field(
            description="Saved card (§15), discriminated by type. Card fields are never edited directly (§6).",
            title="Card",
        ),
    ]
