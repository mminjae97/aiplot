# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr


class LlamaHealth(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    state: Annotated[
        Literal[
            "fake",
            "missing_binary",
            "missing_model",
            "starting",
            "ready",
            "error",
            "stopped",
        ],
        Field(
            description="fake: AIPLOT_FAKE_LLM=1 fixtures, no model. missing_binary / missing_model: first run or files removed. starting: process up, model loading. ready: usable. error: stopped after 3 restarts or a start failure; message says why."
        ),
    ]
    profile: Annotated[
        StrictStr | None, Field(description="Base profile id in use (config/profiles).")
    ]
    restarts: Annotated[
        StrictInt,
        Field(
            description="Restarts of an unresponsive or crashed llama-server in this session (at most 3).",
            ge=0,
        ),
    ]
    message: StrictStr | None


class VramUsage(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    used_mb: Annotated[StrictInt, Field(ge=0)]
    total_mb: Annotated[StrictInt, Field(ge=0)]


class HealthResponse(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    status: Literal["ok"]
    llama: Annotated[LlamaHealth, Field(title="LlamaHealth")]
    vram: Annotated[
        VramUsage | None,
        Field(description="From nvidia-smi; null when it cannot be read."),
    ]
