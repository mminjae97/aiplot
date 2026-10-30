# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictStr


class LoraManifest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Annotated[StrictStr, Field(pattern="^[a-z0-9][a-z0-9-]*$")]
    file: Annotated[
        StrictStr,
        Field(
            description="Adapter file name in the same folder.",
            pattern="^[^/\\\\:]+\\.gguf$",
        ),
    ]
    sha256: Annotated[StrictStr, Field(pattern="^[0-9a-f]{64}$")]
    base_sha256: Annotated[
        StrictStr,
        Field(
            description="sha256 of the base GGUF the adapter was trained for.",
            pattern="^[0-9a-f]{64}$",
        ),
    ]
