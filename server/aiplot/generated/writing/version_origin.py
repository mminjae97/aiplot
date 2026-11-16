# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field

type VersionOrigin = Annotated[Literal["generated", "edited"], Field(title="VersionOrigin")]
