# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field

type TechniqueScope = Annotated[
    Literal["문장", "장면", "회차", "아크", "작품"],
    Field(
        description="The level a technique works at (§9); sentence-only cards are never direction candidates.",
        title="TechniqueScope",
    ),
]
