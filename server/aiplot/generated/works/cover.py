# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictStr

from ..common import cover_id
from ..common import work_id as work_id_1


class Cover(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: cover_id.CoverId
    work_id: work_id_1.WorkId
    created_at: Annotated[StrictStr, Field(description="ISO 8601 UTC.")]
