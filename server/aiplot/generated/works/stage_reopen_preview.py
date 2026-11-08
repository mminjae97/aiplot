# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt


class StageReopenPreview(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    stage: Annotated[Literal[1, 2], Field(description="The locked stage to reopen.")]
    plans: Annotated[
        StrictInt, Field(description="Direction plans deleted (one per episode).", ge=0)
    ]
    chapters: Annotated[StrictInt, Field(description="Written chapters deleted.", ge=0)]
    title_required: Annotated[
        StrictBool,
        Field(
            description="A manuscript would be deleted: the reopen needs the work's title typed."
        ),
    ]
