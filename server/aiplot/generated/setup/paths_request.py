# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictStr


class SetupPathsRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    model_path: Annotated[
        StrictStr | None,
        Field(description="Full path of the base GGUF file.", min_length=1),
    ]
    llama_dir: Annotated[
        StrictStr | None,
        Field(description="Folder that holds llama-server.exe and its DLLs.", min_length=1),
    ]
