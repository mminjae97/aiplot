# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import Field, StrictStr

type TechniqueId = Annotated[
    StrictStr, Field(pattern="^tech_[a-z]{3}_[0-9]{3}$", title="TechniqueId")
]
