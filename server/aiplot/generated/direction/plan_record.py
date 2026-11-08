# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from ..common import card_id, plan_id
from . import plan as plan_1
from . import plan_status


class PlanRecord(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: plan_id.PlanId
    episode_id: card_id.CardId
    status: plan_status.PlanStatus
    plan: plan_1.DirectionPlan
