"""Stage warnings and reopening (§11, §16, §19): the advance preview, the reopen preview, and a
reopen that snapshots the database before it deletes the direction plans."""

# Fixtures imported from other test modules (conn, client, llm) are redefined as test
# parameters by name; that is how pytest passes them.
# ruff: noqa: F811

import asyncio
import sqlite3
import time
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from aiplot.jobs.queue import JobContext, JobQueue, JobRecord
from tests.test_cards import character, save
from tests.test_direction_roles import conn  # noqa: F401
from tests.test_plans_api import AUTH, client, directing, error, llm, made, plans  # noqa: F401


def get(client: TestClient, path: str, **params: Any) -> Any:
    return client.get(f"/api/v1/works/w_01/stage/{path}", headers=AUTH, params=params)


def reopen(client: TestClient, stage: int, **body: Any) -> Any:
    return client.post(
        "/api/v1/works/w_01/stage/reopen", headers=AUTH, json={"stage": stage, **body}
    )


def stage_of(conn: sqlite3.Connection) -> tuple[int, int]:
    row = conn.execute("SELECT stage, locked_stage FROM work WHERE id = 'w_01'").fetchone()
    return int(row[0]), int(row[1])


def snapshots(tmp_path: Path) -> list[Path]:
    folder = tmp_path / "snapshots"
    return sorted(folder.iterdir()) if folder.exists() else []


# advance preview -----------------------------------------------------------------------------


def test_the_advance_preview_lists_what_turns_inactive(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    # c_ghost is incomplete (fixture); 1화 (complete) lists it among its characters.
    save(conn, character("c_lone", "외톨이", theme=None))
    response = get(client, "advance-preview")
    assert response.status_code == 200, response.json()
    preview = response.json()
    assert (preview["stage"], preview["active_episodes"]) == (1, 2)
    by_id = {card["card_id"]: card for card in preview["incomplete"]}
    assert {"c_ghost", "c_lone", "c_fog", "c_ruin"} <= set(by_id)
    assert by_id["c_ghost"]["referenced_by"] == [
        {"card_id": "c_ep1", "type": "episode", "name": "1화"}
    ]
    assert by_id["c_lone"]["referenced_by"] == []
    directing(conn)
    preview = get(client, "advance-preview").json()
    assert (preview["stage"], preview["unconfirmed_episodes"]) == (2, 2)
    conn.execute("UPDATE work SET stage = 3, locked_stage = 2 WHERE id = 'w_01'")
    assert error(get(client, "advance-preview")) == (409, "STAGE_FINAL")


# reopen --------------------------------------------------------------------------------------


def test_reopening_planning_snapshots_then_deletes_the_plans(
    client: TestClient, conn: sqlite3.Connection, tmp_path: Path
) -> None:
    assert error(get(client, "reopen-preview", stage=1)) == (409, "STAGE_NOT_LOCKED")
    directing(conn)
    made(client)
    [plan] = plans(client)
    preview = get(client, "reopen-preview", stage=1).json()
    assert preview == {"stage": 1, "plans": 1, "chapters": 0, "title_required": False}
    cards = conn.execute("SELECT count(*) FROM card").fetchone()[0]
    response = reopen(client, 1)
    assert response.status_code == 200, response.json()
    assert (response.json()["stage"], response.json()["locked_stage"]) == (1, 0)
    assert stage_of(conn) == (1, 0)
    # The plan and its picks are gone; the cards stay.
    assert conn.execute("SELECT count(*) FROM direction_plan").fetchone()[0] == 0
    assert conn.execute("SELECT count(*) FROM technique_pick").fetchone()[0] == 0
    assert conn.execute("SELECT count(*) FROM card").fetchone()[0] == cards
    # The snapshot was taken before: it still holds the plan.
    [copy] = snapshots(tmp_path)
    assert copy.name.startswith("w_01-s1-") and copy.suffix == ".db"
    row = conn.execute("SELECT work_id, stage, path FROM snapshot").fetchone()
    assert tuple(row) == ("w_01", 1, copy.name)
    held = sqlite3.connect(copy)
    try:
        assert held.execute("SELECT id FROM direction_plan").fetchall() == [(plan["id"],)]
    finally:
        held.close()
    # Planning is open again; nothing is locked to reopen.
    assert error(reopen(client, 1)) == (409, "STAGE_NOT_LOCKED")


def test_reopening_direction_keeps_the_plans(
    client: TestClient, conn: sqlite3.Connection, tmp_path: Path
) -> None:
    directing(conn)
    made(client)
    assert error(reopen(client, 2)) == (409, "STAGE_NOT_LOCKED")
    conn.execute("UPDATE work SET stage = 3, locked_stage = 2 WHERE id = 'w_01'")
    preview = get(client, "reopen-preview", stage=2).json()
    assert preview == {"stage": 2, "plans": 0, "chapters": 0, "title_required": False}
    assert reopen(client, 2).status_code == 200
    assert stage_of(conn) == (2, 1)
    assert len(plans(client)) == 1
    assert [p.name.split("-")[1] for p in snapshots(tmp_path)] == ["s2"]


def test_no_snapshot_no_reopen(
    client: TestClient, conn: sqlite3.Connection, tmp_path: Path
) -> None:
    directing(conn)
    made(client)
    # A file where the folder should be: the copy cannot be written.
    (tmp_path / "snapshots").write_text("not a folder")
    assert error(reopen(client, 1)) == (500, "SNAPSHOT_FAILED")
    assert stage_of(conn) == (2, 1)
    assert len(plans(client)) == 1
    assert conn.execute("SELECT count(*) FROM snapshot").fetchone()[0] == 0


def test_bad_stages(client: TestClient, conn: sqlite3.Connection) -> None:
    directing(conn)
    assert error(get(client, "reopen-preview", stage=3)) == (409, "STAGE_NOT_LOCKED")
    assert error(get(client, "reopen-preview", stage=0)) == (409, "STAGE_NOT_LOCKED")
    assert error(reopen(client, 3)) == (422, "VALIDATION_ERROR")
    missing = client.post("/api/v1/works/w_none/stage/reopen", headers=AUTH, json={"stage": 1})
    assert error(missing) == (404, "WORK_NOT_FOUND")


def test_a_reopen_cancels_the_works_direction_jobs(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    directing(conn)
    made(client)
    jobs: JobQueue = client.app.state.jobs  # type: ignore[attr-defined]

    async def waits(ctx: JobContext) -> None:
        await asyncio.sleep(30)

    def submit(kind: str, work_id: str) -> JobRecord:
        return jobs.submit(kind, waits, work_id=work_id)

    portal = client.portal
    assert portal is not None  # the client runs the app's loop
    direct = portal.call(submit, "direct", "w_01")
    other = portal.call(submit, "card", "w_01")
    assert reopen(client, 1).status_code == 200
    deadline = time.monotonic() + 2
    while direct.status != "cancelled" and time.monotonic() < deadline:
        time.sleep(0.01)
    assert direct.status == "cancelled"
    assert other.status != "cancelled"
    portal.call(jobs.cancel, other)


def test_a_deleted_work_takes_its_snapshots(
    client: TestClient, conn: sqlite3.Connection, tmp_path: Path
) -> None:
    directing(conn)
    reopen(client, 1)
    assert len(snapshots(tmp_path)) == 1
    assert client.delete("/api/v1/works/w_01", headers=AUTH).status_code == 204
    assert snapshots(tmp_path) == []
