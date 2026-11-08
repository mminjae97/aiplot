# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from ..technique import technique_device


class SceneDevicesUpdate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    devices: list[technique_device.TechniqueDevice]
