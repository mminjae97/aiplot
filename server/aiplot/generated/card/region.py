# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictFloat, StrictStr

from ..common import card_id


class RegionEnvironment(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    natural: StrictStr | None
    social: StrictStr | None


class RegionSensory(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    smell: StrictStr | None
    sound: StrictStr | None
    mood: StrictStr | None


class RegionTravel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    value: Annotated[StrictFloat, Field(gt=0.0)]
    unit: Literal["minute", "hour", "day"]
    mode: StrictStr | None


class RegionLink(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    target_id: card_id.CardId
    travel: Annotated[
        RegionTravel | None,
        Field(description="Evidence for the impossible-travel check (§10)."),
    ]
    direction: StrictStr | None


class RegionData(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    parent_id: card_id.CardId | None
    links: list[RegionLink]
    appearance: StrictStr | None
    environment: Annotated[RegionEnvironment, Field(title="RegionEnvironment")]
    sensory: Annotated[RegionSensory, Field(title="RegionSensory")]
