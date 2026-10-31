# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictStr

from ..common import cover_id as cover_id_1
from ..common import work_id

type WorkTitle = Annotated[
    StrictStr,
    Field(
        description="Shown on the spine and cover; the server trims it.",
        max_length=100,
        min_length=1,
        title="WorkTitle",
    ),
]


type Color1 = Annotated[
    StrictStr,
    Field(
        description="Spine and cloth cover colour, lowercase #rrggbb; null = the app's default, stable per work id.",
        pattern="^#[0-9a-f]{6}$",
        title="BookColor",
    ),
]


type Color = Annotated[
    Color1 | None,
    Field(
        description="Spine and cloth cover colour, lowercase #rrggbb; null = the app's default, stable per work id.",
        title="BookColor",
    ),
]


class Work(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: work_id.WorkId
    title: WorkTitle
    stage: Annotated[
        Literal[1, 2, 3], Field(description="1 planning, 2 direction, 3 writing (§1).")
    ]
    locked_stage: Annotated[
        Literal[0, 1, 2], Field(description="Highest read-only stage; 0 = none (§11).")
    ]
    last_item: Annotated[
        Literal["world", "characters", "regions", "story", "direction", "writing", "reading"]
        | None,
        Field(description="Contents item opened last, highlighted on S1 (§12)."),
    ]
    color: Color
    cover_id: Annotated[
        cover_id_1.CoverId | None,
        Field(
            description="Cover illustration on the front; null = cloth cover in the book colour."
        ),
    ]
    updated_at: Annotated[StrictStr, Field(description="ISO 8601 UTC.")]
