# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from ..common import technique_id
from . import technique_category, technique_effect, technique_scope, technique_situation

type Alias = Annotated[StrictStr, Field(min_length=1)]


type UseWhenItem = Annotated[StrictStr, Field(min_length=1)]


type AvoidWhenItem = Annotated[StrictStr, Field(min_length=1)]


class TechniqueSource(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    author: Annotated[StrictStr, Field(description="Empty for a general term.")]
    title: Annotated[StrictStr, Field(min_length=1)]
    year: StrictInt | None
    note: StrictStr


class Technique(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: technique_id.TechniqueId
    category: technique_category.TechniqueCategory
    name: Annotated[StrictStr, Field(min_length=1)]
    name_en: Annotated[StrictStr, Field(min_length=1)]
    aliases: list[Alias]
    scope: Annotated[list[technique_scope.TechniqueScope], Field(min_length=1)]
    effects: Annotated[list[technique_effect.TechniqueEffect], Field(min_length=1)]
    situations: Annotated[list[technique_situation.TechniqueSituation], Field(min_length=1)]
    description: Annotated[StrictStr, Field(description="Definition.", min_length=1)]
    effect_detail: Annotated[
        StrictStr, Field(description="What the reader feels and why.", min_length=1)
    ]
    use_when: Annotated[list[UseWhenItem], Field(min_length=1)]
    avoid_when: Annotated[list[AvoidWhenItem], Field(description="Cautions.", min_length=1)]
    requires: Annotated[
        StrictStr,
        Field(
            description="What the story must already hold for the technique to work.",
            min_length=1,
        ),
    ]
    mechanism: Annotated[
        StrictStr,
        Field(
            description="How to apply it to the chronological story (direct).",
            min_length=1,
        ),
    ]
    prompt_hint: Annotated[
        StrictStr,
        Field(
            description="One instruction line for a beat that realizes it (write).",
            min_length=1,
        ),
    ]
    example: Annotated[StrictStr, Field(description="A short sample: UI only.", min_length=1)]
    sources: Annotated[list[TechniqueSource], Field(min_length=1)]
    pairs_with: Annotated[
        list[technique_id.TechniqueId],
        Field(description="Techniques that combine well."),
    ]
    conflicts_with: Annotated[
        list[technique_id.TechniqueId],
        Field(
            description="Techniques it cannot share a scene with; a pair conflicts if either card lists the other."
        ),
    ]
