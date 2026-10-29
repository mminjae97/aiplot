# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import Field, StrictStr

type WorldlineId = Annotated[StrictStr, Field(pattern="^wl_[0-9A-Za-z]+$", title="WorldlineId")]
