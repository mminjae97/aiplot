"""Stage advance and locks (§1, §11, §16, §19): planning -> direction locks every stage-1 write."""

import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from aiplot.db.connection import connect
from aiplot.db.migrate import init_db
from aiplot.main import create_app
from aiplot.services.works import StageLockedError
from tests.test_card_delete import episode
from tests.test_cards import fixture, region, save, story

TOKEN = "test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def conn(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    path = tmp_path / "data" / "aiplot.db"
    init_db(path)
    conn = connect(path)
    conn.execute(
        "INSERT INTO work (id, title, updated_at) VALUES ('w_01', '책', '2026-10-31T00:00:00Z')"
    )
    yield conn
    conn.close()


@pytest.fixture
def client(tmp_path: Path, conn: sqlite3.Connection) -> TestClient:
    return TestClient(create_app(token=TOKEN, db_path=tmp_path / "data" / "aiplot.db"))


def advance(client: TestClient, work_id: str = "w_01") -> Any:
    return client.post(f"/api/v1/works/{work_id}/stage/advance", headers=AUTH)


def error(response: Any) -> tuple[int, str]:
    return response.status_code, response.json()["code"]


def ready(conn: sqlite3.Connection) -> None:
    """One active episode: complete, in a complete part, under a complete main story."""
    story(conn)
    save(conn, episode("c_e1", characters=["c_teo"]))


def test_planning_needs_an_active_episode(client: TestClient, conn: sqlite3.Connection) -> None:
    assert error(advance(client)) == (409, "NO_ACTIVE_EPISODE")
    story(conn)
    # An incomplete episode is inactive (§11).
    save(conn, episode("c_e1", characters=[]))
    assert error(advance(client)) == (409, "NO_ACTIVE_EPISODE")
    save(conn, episode("c_e1", characters=["c_teo"]))
    # So is a complete one whose part or main story is incomplete.
    part = fixture("part", id="c_part1")
    save(conn, {**part, "data": {**part["data"], "theme": None}})
    assert error(advance(client)) == (409, "NO_ACTIVE_EPISODE")
    save(conn, part)
    main = fixture("main-story", id="c_main")
    save(conn, {**main, "data": {**main["data"], "ending": None}})
    assert error(advance(client)) == (409, "NO_ACTIVE_EPISODE")
    save(conn, main)
    assert tuple(conn.execute("SELECT stage, locked_stage FROM work").fetchone()) == (1, 0)


def test_advance_locks_planning(client: TestClient, conn: sqlite3.Connection) -> None:
    ready(conn)
    # An incomplete card does not block it (§11).
    save(conn, fixture("character-undecided", id="c_vague"))
    response = advance(client)
    assert response.status_code == 200, response.json()
    work = response.json()
    assert (work["stage"], work["locked_stage"]) == (2, 1)
    assert work["updated_at"] != "2026-10-31T00:00:00Z"
    assert error(advance(client)) == (409, "STAGE_NOT_READY")
    assert error(advance(client, "w_nope")) == (404, "WORK_NOT_FOUND")
    assert client.post("/api/v1/works/w_01/stage/advance").status_code == 401


def test_every_stage_one_write_is_locked(client: TestClient, conn: sqlite3.Connection) -> None:
    ready(conn)
    save(conn, region("c_far", "먼 곳"))
    client.delete("/api/v1/cards/c_far", headers=AUTH)
    advance(client)
    calls = [
        ("PATCH", "/api/v1/cards/c_port", {"map_x": 1, "map_y": 2}),
        ("DELETE", "/api/v1/cards/c_teo", None),
        ("DELETE", "/api/v1/cards/c_e1?reconnect=true", None),
        ("POST", "/api/v1/cards/c_far/restore", None),
    ]
    for method, path, body in calls:
        response = client.request(method, path, headers=AUTH, json=body)
        assert error(response) == (423, "STAGE_LOCKED"), path
    # Saving a card (drafts, unit 9) is a stage-1 write too.
    for value in (fixture("world", id="c_new"), episode("c_e1", characters=[])):
        with pytest.raises(StageLockedError):
            save(conn, value)
    assert conn.execute("SELECT count(*) FROM card WHERE id = 'c_new'").fetchone()[0] == 0
    assert conn.execute("SELECT status FROM card WHERE id = 'c_e1'").fetchone()[0] == "complete"
    # Reading stays open, and so does decorating the book.
    assert client.get("/api/v1/works/w_01/cards", headers=AUTH).status_code == 200
    renamed = client.patch("/api/v1/works/w_01", headers=AUTH, json={"title": "새 제목"})
    assert renamed.status_code == 200


def test_writing_is_the_last_stage(client: TestClient, conn: sqlite3.Connection) -> None:
    conn.execute("UPDATE work SET stage = 3, locked_stage = 2")
    assert error(advance(client)) == (409, "STAGE_FINAL")
