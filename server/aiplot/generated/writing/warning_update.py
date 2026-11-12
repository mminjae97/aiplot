# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictStr

from . import warning_status


class WarningUpdate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    status: warning_status.WarningStatus
    reason: Annotated[
        StrictStr | None,
        Field(description="With status ignored: why; blank = none.", max_length=500),
    ] = None
