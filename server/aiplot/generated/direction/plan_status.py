# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field

type PlanStatus = Annotated[
    Literal["directing", "confirmed"],
    Field(
        description="A direction plan's state (§9, §14): directing until every scene is confirmed, then confirmed.",
        title="PlanStatus",
    ),
]
