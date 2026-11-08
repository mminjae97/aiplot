"""장면 연출 as a job (§9, §16): the `direct` role writes one scene's beats from the stored plan;
the beats are stored on the scene, directed, or stale if its place or cards changed meanwhile."""

import sqlite3
from pathlib import Path
from typing import Any

from aiplot.db import plans as plans_db
from aiplot.db.connection import connect
from aiplot.jobs.queue import JobContext, JobError, JobQueue
from aiplot.llm.client import LlmError
from aiplot.llm.router import Router
from aiplot.services import cards, direction, plan_scenes, plans, works

# Job error codes for refusals met after the job was accepted: the plan, the scene, its cards
# or the stage changed while it waited or ran (§16).
REFUSALS: dict[type[Exception], str] = {
    plan_scenes.PlanNotFoundError: "PLAN_NOT_FOUND",
    plan_scenes.SceneNotFoundError: "SCENE_NOT_FOUND",
    direction.SceneNotReadyError: "SCENE_NOT_READY",
    direction.EpisodeNotReadyError: "EPISODE_NOT_READY",
    works.WorkNotFoundError: "PLAN_NOT_FOUND",
    cards.CardNotFoundError: "PLAN_NOT_FOUND",
    works.StageLockedError: "STAGE_LOCKED",
    works.StageNotStartedError: "STAGE_NOT_STARTED",
}


def check(conn: sqlite3.Connection, plan_id: str, number: int) -> str:
    """The plan's work id, if the scene may be directed now: direction is the current stage, the
    scene is in the plan, its episode is active and its 1-3 chosen cards are allowed (all
    before any model call)."""
    record = plans_db.get(conn, plan_id)
    if record is None:
        raise plan_scenes.PlanNotFoundError(plan_id)
    work_id = plans.work_of_episode(conn, record.episode_id)
    works.require_current(conn, work_id, plans.DIRECTION_STAGE)
    plan_scenes.scene_in(record.plan, number)
    direction.prepare_direct(conn, record.plan, number)
    return work_id


def start(
    router: Router, jobs: JobQueue, db_path: Path, plan_id: str, number: int, work_id: str
) -> str:
    """Submits the scene's direct job; the scene's job already running answers instead. The
    job reads the plan when it starts, so edits made while it waited are directed. Its result
    is {plan: PlanRecord}."""

    async def run(ctx: JobContext) -> dict[str, Any]:
        conn = connect(db_path)
        try:
            ctx.progress(0, 1, "direct")
            record = plans_db.get(conn, plan_id)
            if record is None:
                raise plan_scenes.PlanNotFoundError(plan_id)
            works.require_current(
                conn, plans.work_of_episode(conn, record.episode_id), plans.DIRECTION_STAGE
            )
            plan_scenes.scene_in(record.plan, number)
            basis = plan_scenes.basis_of(record.plan, number)
            result = await direction.direct_scene(router, conn, record.plan, number)
            stored = plan_scenes.store_beats(conn, plan_id, number, result.beats, basis)
            ctx.progress(1, 1, "direct")
            return {"plan": stored.model_dump(mode="json")}
        except LlmError as exc:
            raise JobError(exc.code, str(exc)) from exc
        except tuple(REFUSALS) as exc:
            raise JobError(plans.refusal_code(exc, REFUSALS), str(exc)) from exc
        finally:
            conn.close()

    job = jobs.submit("direct", run, work_id=work_id, key=f"direct:{plan_id}:{number}")
    return job.id
