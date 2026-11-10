"""SQL for direction plans and technique picks (§14)."""

import json
import sqlite3
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from aiplot.db import works as works_db
from aiplot.generated.direction.plan import DirectionPlan
from aiplot.generated.direction.plan_record import PlanRecord
from aiplot.generated.direction.plan_status import PlanStatus

COLUMNS = "id, episode_id, status, plan"


@dataclass(frozen=True)
class Pick:
    """A technique_pick row: rank None = a card the user added; matched = the devices and tags
    it shares with the scene."""

    rank: int | None
    technique_id: str
    matched: dict[str, Any]
    chosen: bool


def to_record(row: sqlite3.Row) -> PlanRecord:
    return PlanRecord.model_validate(
        {
            "id": row["id"],
            "episode_id": row["episode_id"],
            "status": row["status"],
            "plan": json.loads(row["plan"]),
        }
    )


def get(conn: sqlite3.Connection, plan_id: str) -> PlanRecord | None:
    row = conn.execute(f"SELECT {COLUMNS} FROM direction_plan WHERE id = ?", (plan_id,)).fetchone()
    return to_record(row) if row else None


def for_episode(conn: sqlite3.Connection, episode_id: str) -> PlanRecord | None:
    row = conn.execute(
        f"SELECT {COLUMNS} FROM direction_plan WHERE episode_id = ?", (episode_id,)
    ).fetchone()
    return to_record(row) if row else None


def insert(conn: sqlite3.Connection, plan_id: str, status: PlanStatus, plan: DirectionPlan) -> None:
    conn.execute(
        "INSERT INTO direction_plan (id, episode_id, status, plan) VALUES (?, ?, ?, ?)",
        (plan_id, plan.episode, status, plan.model_dump_json()),
    )


def update(conn: sqlite3.Connection, plan_id: str, status: PlanStatus, plan: DirectionPlan) -> None:
    conn.execute(
        "UPDATE direction_plan SET status = ?, plan = ? WHERE id = ?",
        (status, plan.model_dump_json(), plan_id),
    )


def delete_for_episode(conn: sqlite3.Connection, episode_id: str) -> None:
    # Its technique_pick rows go with it (ON DELETE CASCADE).
    conn.execute("DELETE FROM direction_plan WHERE episode_id = ?", (episode_id,))


def confirmed_in_story_order(conn: sqlite3.Connection, work_id: str) -> list[PlanRecord]:
    """The confirmed plans of the work's active episodes (§11) in story order: by part, then
    the episode's order in it, then as the episodes were made."""
    rows = conn.execute(
        f"SELECT {', '.join(f'd.{name}' for name in COLUMNS.split(', '))} "
        "FROM direction_plan AS d JOIN episode AS ep ON ep.card_id = d.episode_id "
        "JOIN card AS c ON c.id = d.episode_id LEFT JOIN part AS pt ON pt.card_id = ep.part_id "
        "WHERE d.status = 'confirmed' "
        f"AND d.episode_id IN (SELECT e.id {works_db.ACTIVE_EPISODES} AND e.work_id = ?) "
        'ORDER BY pt."order", ep."order", c.rowid',
        (work_id,),
    ).fetchall()
    return [to_record(row) for row in rows]


def count_for_work(conn: sqlite3.Connection, work_id: str) -> int:
    row = conn.execute(
        "SELECT count(*) FROM direction_plan AS d JOIN card AS c ON c.id = d.episode_id "
        "WHERE c.work_id = ?",
        (work_id,),
    ).fetchone()
    return int(row[0])


def delete_for_work(conn: sqlite3.Connection, work_id: str) -> None:
    # Their technique_pick rows go with them (ON DELETE CASCADE).
    conn.execute(
        "DELETE FROM direction_plan WHERE episode_id IN (SELECT id FROM card WHERE work_id = ?)",
        (work_id,),
    )


def write_picks(conn: sqlite3.Connection, plan_id: str, scene: int, picks: Sequence[Pick]) -> None:
    """The scene's technique_pick rows become exactly these."""
    conn.execute("DELETE FROM technique_pick WHERE plan_id = ? AND scene = ?", (plan_id, scene))
    conn.executemany(
        "INSERT INTO technique_pick (plan_id, scene, rank, technique_id, matched, chosen) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        [
            (
                plan_id,
                scene,
                pick.rank,
                pick.technique_id,
                json.dumps(pick.matched, ensure_ascii=False),
                int(pick.chosen),
            )
            for pick in picks
        ],
    )
