# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field

type BeatFocus = Annotated[
    Literal["감정", "행동", "정보"],
    Field(description="What a beat dwells on (§9).", title="BeatFocus"),
]
