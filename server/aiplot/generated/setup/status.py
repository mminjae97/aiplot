# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr

from ..common import job_id as job_id_1


class SetupItem(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Annotated[
        Literal["llama", "model"],
        Field(description="llama: llama.cpp server build. model: base GGUF."),
    ]
    status: Annotated[
        Literal["installed", "partial", "missing"],
        Field(
            description="installed: usable. partial: a resumable download is on disk. missing: nothing yet."
        ),
    ]
    path: Annotated[
        StrictStr,
        Field(
            description="Where the server looks (default under the data dir, or the path the user set)."
        ),
    ]
    custom: Annotated[
        StrictBool,
        Field(description="True when the user pointed to an existing file or folder."),
    ]
    total_bytes: Annotated[
        StrictInt, Field(description="Download size (llama: both archives).", ge=0)
    ]
    present_bytes: Annotated[StrictInt, Field(ge=0)]


class SetupStatus(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    items: list[SetupItem]
    remaining_bytes: Annotated[
        StrictInt,
        Field(description="Still to download for everything not installed.", ge=0),
    ]
    free_bytes: Annotated[StrictInt, Field(description="Free space on the data dir's drive.", ge=0)]
    job_id: Annotated[
        job_id_1.JobId | None,
        Field(description="Download or path check running now, if any."),
    ]
