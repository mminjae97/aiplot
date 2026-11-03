# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field

type TechniqueCategory = Annotated[
    Literal["rhe", "str", "tim", "voi", "inf", "cha", "des", "ser"],
    Field(
        description="Catalog field (§9): rhe 수사법·문체, str 구성·플롯 구조, tim 시간·속도, voi 시점·서술자·화법, inf 정보 조절·긴장·장르 효과, cha 인물·대화, des 묘사·공간·상징·상호텍스트, ser 도입·결말·연재·매체 차용.",
        title="TechniqueCategory",
    ),
]
