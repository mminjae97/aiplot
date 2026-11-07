# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

type RevealItem = Annotated[StrictStr, Field(min_length=1)]


class ArrangeScene(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    scene: Annotated[
        StrictInt,
        Field(
            description="The scene's story-order number (narrowed per call to 1..n).",
            ge=1,
        ),
    ]
    target_chars: Annotated[
        StrictInt,
        Field(
            description="The scene's share of its chapter in characters (a proportion: the server rescales).",
            ge=1,
        ),
    ]
    reveal: Annotated[
        list[RevealItem],
        Field(description="What the scene reveals to the reader, possibly nothing."),
    ]


class ArrangeChapter(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    scenes: Annotated[
        list[ArrangeScene],
        Field(
            description="In narration order; the chapter is cut after its last scene, on a hook.",
            min_length=1,
        ),
    ]


class ArrangeOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    chapters: Annotated[list[ArrangeChapter], Field(max_length=5, min_length=1)]
