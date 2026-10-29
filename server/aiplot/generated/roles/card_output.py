# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from ..card import card, character, episode, main_story, part, region


class CharacterCardOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["character"]
    name: card.CardName
    data: character.CharacterData
    evidence: card.CardEvidence
    ai_guess: card.AiGuessFields


class RegionCardOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["region"]
    name: card.CardName
    data: region.RegionData
    evidence: card.CardEvidence
    ai_guess: card.AiGuessFields


class MainStoryCardOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["main_story"]
    name: card.CardName
    data: main_story.MainStoryData
    evidence: card.CardEvidence
    ai_guess: card.AiGuessFields


class PartCardOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["part"]
    name: card.CardName
    data: part.PartData
    evidence: card.CardEvidence
    ai_guess: card.AiGuessFields


class EpisodeCardOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type: Literal["episode"]
    name: card.CardName
    data: episode.EpisodeData
    evidence: card.CardEvidence
    ai_guess: card.AiGuessFields


type CardOutput = Annotated[
    CharacterCardOutput
    | RegionCardOutput
    | MainStoryCardOutput
    | PartCardOutput
    | EpisodeCardOutput,
    Field(
        description="`card` role output (§13) for the requested type. Evidence indexes refer to the [n]-numbered note sentences in the prompt; the server drops out-of-range indexes and restores pinned fields.",
        discriminator="type",
        title="CardOutput",
    ),
]
