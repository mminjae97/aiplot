# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field

type BeatMode = Annotated[
    Literal["장면화", "요약"],
    Field(
        description="How a beat is narrated (§9): 장면화 shows it moment by moment, 요약 tells it in brief.",
        title="BeatMode",
    ),
]
