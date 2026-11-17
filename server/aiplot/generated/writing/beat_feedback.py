# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from . import feedback_rating


class BeatFeedback(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    version: Annotated[
        StrictInt,
        Field(
            description="The version rated: the text the user read.",
            ge=1,
            le=2147483647,
        ),
    ]
    rating: feedback_rating.FeedbackRating | None
    note: Annotated[
        StrictStr | None,
        Field(
            description="Why, in the user's words; blank or left out = none.",
            max_length=500,
        ),
    ] = None
