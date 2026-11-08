# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import Field, StrictStr

type PlanId = Annotated[StrictStr, Field(pattern="^pl_[0-9A-Za-z]+$", title="PlanId")]
