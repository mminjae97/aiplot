# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import Field, RootModel


class CardId(RootModel[str]):
    root: Annotated[str, Field(pattern="^c_[0-9A-Za-z]+$", title="CardId")]
