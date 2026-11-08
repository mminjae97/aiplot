"""Direction plans (§9, §14): one per episode, made by a job (`scene`, then `arrange`) and stored
with each scene's recommended cards mirrored in technique_pick.

Plans change only while direction is the current stage (§1): before the advance the episode
may still change, after the advance to writing they are locked.
"""

import secrets
import sqlite3
from pathlib import Path
from typing import Any

from aiplot.db import plans as plans_db
from aiplot.db import techniques as techniques_db
from aiplot.db.connection import connect, transaction
from aiplot.generated.direction.plan import DirectionPlan, PlanScene
from aiplot.generated.direction.plan_record import PlanRecord
from aiplot.jobs.queue import JobContext, JobError, JobQueue
from aiplot.llm.client import LlmError
from aiplot.llm.router import Router
from aiplot.services import cards, direction, works

DIRECTION_STAGE = 2


class PlanExistsError(ValueError):
    """The episode has a plan; making another replaces it only when asked (?replace=true)."""


def work_of_episode(conn: sqlite3.Connection, episode_id: str) -> str:
    card = cards.get(conn, episode_id)
    if card is None:
        raise cards.CardNotFoundError(episode_id)
    return card.work_id


def for_episode(conn: sqlite3.Connection, episode_id: str) -> list[PlanRecord]:
    """The episode's plan, if it has one."""
    work_of_episode(conn, episode_id)
    found = plans_db.for_episode(conn, episode_id)
    return [found] if found is not None else []


def check_new(conn: sqlite3.Connection, episode_id: str, replace: bool) -> str:
    """The episode's work id, if a plan may be made for it now: direction is the current stage,
    the episode is ready (direction.ready_episode) and has no plan unless it is replaced."""
    work_id = work_of_episode(conn, episode_id)
    works.require_current(conn, work_id, DIRECTION_STAGE)
    direction.ready_episode(conn, episode_id)
    if not replace and plans_db.for_episode(conn, episode_id) is not None:
        raise PlanExistsError(f"{episode_id} already has a plan")
    return work_id


def picks(conn: sqlite3.Connection, scene: PlanScene) -> list[plans_db.Pick]:
    """A scene's technique_pick rows: its recommended cards, then the chosen ones not among them
    (the user's own: rank null) with what they share with the scene."""
    chosen = set(scene.chosen)
    fields = {"devices", "effects", "situations"}
    rows = [
        plans_db.Pick(
            found.rank,
            found.technique,
            found.model_dump(mode="json", include=fields),
            found.technique in chosen,
        )
        for found in scene.recommended
    ]
    recommended = {found.technique for found in scene.recommended}
    for technique_id in scene.chosen:
        if technique_id in recommended:
            continue
        card = techniques_db.get(conn, technique_id)
        matched: dict[str, Any] = {"devices": [], "effects": [], "situations": []}
        if card is not None:
            found = direction.shared(card, scene.devices, scene.effects, scene.situations)
            matched = {
                "devices": found.devices,
                "effects": found.effects,
                "situations": found.situations,
            }
        rows.append(plans_db.Pick(None, technique_id, matched, True))
    return rows


def store_new(conn: sqlite3.Connection, plan: DirectionPlan, replace: bool) -> PlanRecord:
    """Writes the plan and its picks in one transaction, checked again: the stage or the
    episode may have changed while the roles ran. A replaced plan goes with all it held."""
    with transaction(conn):
        check_new(conn, plan.episode, replace)
        plans_db.delete_for_episode(conn, plan.episode)
        plan_id = f"pl_{secrets.token_hex(8)}"
        plans_db.insert(conn, plan_id, "directing", plan)
        for chapter in plan.chapters:
            for scene in chapter.scenes:
                plans_db.write_picks(conn, plan_id, scene.scene, picks(conn, scene))
    stored = plans_db.get(conn, plan_id)
    assert stored is not None
    return stored


# Job error codes for the refusals a plan job can meet after it was accepted: the episode or
# the stage changed while it waited or ran (§16).
SAVE_ERRORS: dict[type[Exception], str] = {
    works.WorkNotFoundError: "WORK_NOT_FOUND",
    works.StageLockedError: "STAGE_LOCKED",
    works.StageNotStartedError: "STAGE_NOT_STARTED",
    direction.EpisodeNotReadyError: "EPISODE_NOT_READY",
    cards.CardNotFoundError: "CARD_NOT_FOUND",
    PlanExistsError: "PLAN_EXISTS",
}


def refusal_code(exc: Exception) -> str:
    return next(code for kind, code in SAVE_ERRORS.items() if isinstance(exc, kind))


def start_new(
    router: Router, jobs: JobQueue, db_path: Path, episode_id: str, work_id: str, replace: bool
) -> str:
    """Submits the plan job (POST /episodes/{episodeId}/plans): the episode's job already
    running answers instead. Its result is {plan: PlanRecord}."""

    async def run(ctx: JobContext) -> dict[str, Any]:
        conn = connect(db_path)
        try:
            ctx.progress(0, 2, "scene")
            split = await direction.split_scenes(router, conn, episode_id)
            ctx.progress(1, 2, "arrange")
            arranged = await direction.arrange_scenes(router, conn, episode_id, split.scenes)
            plan = direction.build_plan(conn, episode_id, split.scenes, arranged.chapters)
            stored = store_new(conn, plan, replace)
            ctx.progress(2, 2, "arrange")
            return {"plan": stored.model_dump(mode="json")}
        except LlmError as exc:
            raise JobError(exc.code, str(exc)) from exc
        except tuple(SAVE_ERRORS) as exc:
            raise JobError(refusal_code(exc), str(exc)) from exc
        finally:
            conn.close()

    job = jobs.submit("plan", run, work_id=work_id, key=f"plan:{episode_id}")
    return job.id
