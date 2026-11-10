# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from . import chapter


class ChapterList(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    chapters: list[chapter.Chapter]
