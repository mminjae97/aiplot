# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field

type StateKey = Annotated[
    Literal[
        "location",
        "injury",
        "item",
        "knows_secret",
        "relation_change",
        "appearance_change",
    ],
    Field(description="The fixed state keys (§7).", title="StateKey"),
]
