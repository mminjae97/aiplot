# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from ..common import beat_id as beat_id_1
from ..common import card_id as card_id_1
from ..common import warning_id
from . import warning_kind, warning_status


class Warning(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: warning_id.WarningId
    beat_id: beat_id_1.BeatId
    version: Annotated[StrictInt, Field(description="The beat version it was made on.", ge=1)]
    kind: warning_kind.WarningKind
    sentence: Annotated[
        StrictInt | None,
        Field(
            description="The 1-based number of the sentence it is about, in the server's split of the version's text (§15 Sentences); null when it is about no one sentence.",
            ge=1,
        ),
    ]
    card_id: Annotated[card_id_1.CardId | None, Field(description="The evidence card, if any.")]
    status: warning_status.WarningStatus
    reason: Annotated[
        StrictStr, Field(description="Why it was raised (a banned phrase: the phrase).")
    ]
    ignore_reason: Annotated[
        StrictStr | None,
        Field(description="The user's reason for ignoring it; later checks are told it."),
    ]
