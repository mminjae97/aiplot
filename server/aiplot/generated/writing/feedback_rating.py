# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field

type FeedbackRating = Annotated[
    Literal["good", "bad"],
    Field(
        description="The user's 좋음 (good) or 별로 (bad) on a beat version, kept as training feedback (§9, §18).",
        title="FeedbackRating",
    ),
]
