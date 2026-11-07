# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field

type SceneStatus = Annotated[
    Literal["undirected", "directed", "stale", "confirmed"],
    Field(
        description="A plan scene's direction state (§9): undirected (no beats yet), directed, stale (its place or neighbours changed after it was directed: direct again), confirmed.",
        title="SceneStatus",
    ),
]
