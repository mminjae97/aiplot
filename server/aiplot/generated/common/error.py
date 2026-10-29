# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictStr


class ApiError(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    code: Annotated[StrictStr, Field(pattern="^[A-Z][A-Z0-9_]*$")]
    message: StrictStr
    hint: StrictStr | None
