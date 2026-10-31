# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import Field, StrictStr

type CoverId = Annotated[StrictStr, Field(pattern="^cv_[0-9A-Za-z]+$", title="CoverId")]
