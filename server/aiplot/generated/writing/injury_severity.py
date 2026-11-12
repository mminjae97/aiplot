# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field

type InjurySeverity = Annotated[Literal["가벼움", "보통", "심함"], Field(title="InjurySeverity")]
