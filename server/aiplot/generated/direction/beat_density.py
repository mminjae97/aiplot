# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field

type BeatDensity = Annotated[
    Literal["담백", "자세히"],
    Field(
        description="How much detail a beat gives (§9), independent of its focus.",
        title="BeatDensity",
    ),
]
