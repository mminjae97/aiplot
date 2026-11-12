# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field

type WarningKind = Annotated[
    Literal[
        "character",
        "appearance",
        "travel",
        "state",
        "world_rule",
        "banned_phrase",
        "check_failed",
    ],
    Field(
        description="What a warning is about (§10): the check role's five kinds (out-of-character action, appearance mismatch, impossible travel, state contradiction, world-rule violation), a banned phrase kept in the beat after its regenerations, and a beat whose check failed.",
        title="WarningKind",
    ),
]
