# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from . import beat_version


class BeatVersionList(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    versions: list[beat_version.BeatVersion]
