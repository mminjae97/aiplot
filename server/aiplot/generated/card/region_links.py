# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictStr

from ..common import card_id
from . import region


class RegionLinkRow(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    from_id: card_id.CardId
    to_id: card_id.CardId
    travel: Annotated[
        region.RegionTravel | None,
        Field(description="null when the journey is unknown."),
    ]
    direction: Annotated[
        StrictStr | None,
        Field(description="Where to_id lies from from_id, as written (e.g. 남)."),
    ]


class RegionLinks(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    links: list[RegionLinkRow]
