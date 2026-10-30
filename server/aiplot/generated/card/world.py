# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictStr

from ..common import card_id


class WorldRule(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    rule: Annotated[StrictStr, Field(min_length=1)]
    exception: StrictStr | None


class WorldTerm(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    term: Annotated[StrictStr, Field(min_length=1)]
    meaning: StrictStr | None


class WorldData(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    category: Annotated[
        Literal["rule", "faction", "history", "culture", "other"] | None,
        Field(
            description="rule 규칙·능력, faction 세력·조직, history 역사·사건, culture 문화·용어, other 기타."
        ),
    ]
    summary: StrictStr | None
    details: StrictStr | None
    rules: Annotated[list[WorldRule], Field(description="Evidence for the world-rule check (§10).")]
    terms: list[WorldTerm]
    related: Annotated[
        list[card_id.CardId],
        Field(
            description="Character, region or world cards this topic involves (e.g. faction members, where a rule holds)."
        ),
    ]
