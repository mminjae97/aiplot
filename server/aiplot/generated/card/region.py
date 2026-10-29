# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from ..common import card_id


class RegionEnvironment(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    natural: str | None
    social: str | None


class RegionSensory(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    smell: str | None
    sound: str | None
    mood: str | None


class RegionTravel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    value: Annotated[float, Field(gt=0.0)]
    unit: Literal["minute", "hour", "day"]
    mode: str | None


class RegionLink(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    target_id: Annotated[str, Field(pattern="^c_[0-9A-Za-z]+$", title="CardId")]
    travel: Annotated[
        RegionTravel | None,
        Field(description="Evidence for the impossible-travel check (§10)."),
    ]
    direction: str | None


class RegionData(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    parent_id: card_id.CardId | None
    links: list[RegionLink]
    appearance: str | None
    environment: Annotated[RegionEnvironment, Field(title="RegionEnvironment")]
    sensory: Annotated[RegionSensory, Field(title="RegionSensory")]
