"""Drafts over HTTP (§8, §16): opening the drawer, notes, closing; nothing reaches disk (§6)."""

import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from aiplot.db.connection import connect
from aiplot.db.migrate import init_db
from aiplot.main import create_app
from tests.test_card_delete import dump
from tests.test_cards import fixture, save, story

TOKEN = "test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def conn(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    path = tmp_path / "data" / "aiplot.db"
    init_db(path)
    conn = connect(path)
    for work_id in ("w_01", "w_02"):
        conn.execute(
            "INSERT INTO work (id, title, updated_at) VALUES (?, ?, '2026-10-31T00:00:00Z')",
            (work_id, work_id),
        )
    yield conn
    conn.close()


@pytest.fixture
def client(tmp_path: Path, conn: sqlite3.Connection) -> TestClient:
    return TestClient(create_app(token=TOKEN, db_path=tmp_path / "data" / "aiplot.db"))


def create(client: TestClient, body: dict[str, Any], work_id: str = "w_01") -> Any:
    return client.post(f"/api/v1/works/{work_id}/drafts", headers=AUTH, json=body)


def opened(client: TestClient, body: dict[str, Any]) -> dict[str, Any]:
    response = create(client, body)
    assert response.status_code == 201, response.json()
    draft: dict[str, Any] = response.json()
    return draft


def error(response: Any) -> tuple[int, str]:
    return response.status_code, response.json()["code"]


def test_new_card_starts_empty(client: TestClient) -> None:
    draft = opened(client, {"type": "world", "category": "rule"})
    assert draft["id"].startswith("dr_")
    assert {
        k: draft[k] for k in ("type", "card_id", "category", "notes", "turns", "generated")
    } == {
        "type": "world",
        "card_id": None,
        "category": "rule",
        "notes": "",
        "turns": [],
        "generated": None,
    }
    assert client.get(f"/api/v1/drafts/{draft['id']}", headers=AUTH).json() == draft


def test_edit_mode_loads_notes_and_pins(client: TestClient, conn: sqlite3.Connection) -> None:
    save(conn, {**fixture("character"), "pinned": ["speech.examples"]})
    draft = opened(client, {"type": "character", "card_id": "c_teo"})
    assert draft["notes"] == "테오는 북부 항구 출신이다. 말수가 적다."
    assert draft["sentences"] == ["테오는 북부 항구 출신이다.", "말수가 적다."]
    assert draft["pinned"] == ["speech.examples"]
    assert draft["turns"] == []


def test_new_episode_goes_into_a_part(client: TestClient, conn: sqlite3.Connection) -> None:
    story(conn)
    assert opened(client, {"type": "episode", "part_id": "c_part1"})["part_id"] == "c_part1"


@pytest.mark.parametrize(
    ("body", "status", "code"),
    [
        ({"type": "region", "card_id": "c_teo"}, 422, "DRAFT_INVALID"),
        ({"type": "character", "card_id": "c_nope"}, 404, "CARD_NOT_FOUND"),
        ({"type": "character", "card_id": "c_other"}, 404, "CARD_NOT_FOUND"),
        ({"type": "character", "category": "rule"}, 422, "DRAFT_INVALID"),
        ({"type": "episode", "part_id": "c_teo"}, 422, "DRAFT_INVALID"),
        ({"type": "character", "part_id": "c_part1"}, 422, "DRAFT_INVALID"),
        ({"type": "dragon"}, 422, "VALIDATION_ERROR"),
    ],
)
def test_create_rejects(
    client: TestClient, conn: sqlite3.Connection, body: dict[str, Any], status: int, code: str
) -> None:
    story(conn)
    save(conn, fixture("character", id="c_other", work_id="w_02"))
    assert error(create(client, body)) == (status, code)


def test_locked_planning_never_opens_the_drawer(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    conn.execute("UPDATE work SET stage = 2, locked_stage = 1 WHERE id = 'w_01'")
    assert error(create(client, {"type": "world"})) == (423, "STAGE_LOCKED")
    assert error(create(client, {"type": "world"}, "w_nope")) == (404, "WORK_NOT_FOUND")


def test_notes_edits_and_close(client: TestClient) -> None:
    draft = opened(client, {"type": "character"})
    notes = '테오는 "가자." 하고 말했다. 활을 쓴다!\n동생이 있다'
    response = client.put(
        f"/api/v1/drafts/{draft['id']}/source", headers=AUTH, json={"notes": notes}
    )
    assert response.status_code == 200, response.json()
    assert response.json()["notes"] == notes
    assert response.json()["sentences"] == [
        '테오는 "가자." 하고 말했다.',
        "활을 쓴다!",
        "동생이 있다",
    ]
    assert client.delete(f"/api/v1/drafts/{draft['id']}", headers=AUTH).status_code == 204
    for method, path in (
        ("GET", f"/api/v1/drafts/{draft['id']}"),
        ("DELETE", f"/api/v1/drafts/{draft['id']}"),
        ("PUT", f"/api/v1/drafts/{draft['id']}/source"),
    ):
        response = client.request(method, path, headers=AUTH, json={"notes": ""})
        assert error(response) == (404, "DRAFT_NOT_FOUND")


def test_drafts_are_never_written_to_disk(
    client: TestClient, conn: sqlite3.Connection, tmp_path: Path
) -> None:
    db_files = {"aiplot.db", "aiplot.db-wal", "aiplot.db-shm"}

    def files() -> dict[str, int]:
        # The database is compared by content (dump and bytes below), every other file by size.
        return {
            str(p.relative_to(tmp_path)): p.stat().st_size
            for p in tmp_path.rglob("*")
            if p.is_file() and p.name not in db_files
        }

    def database_bytes() -> bytes:
        # WAL mode (§14): a committed write may still sit in the -wal file.
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        folder = tmp_path / "data"
        return b"".join(
            (folder / name).read_bytes() for name in db_files if (folder / name).exists()
        )

    save(conn, fixture("character"))
    before, before_files = dump(conn), files()
    draft = opened(client, {"type": "character", "card_id": "c_teo"})
    client.put(
        f"/api/v1/drafts/{draft['id']}/source", headers=AUTH, json={"notes": "비밀 설정이다."}
    )
    opened(client, {"type": "world"})
    assert dump(conn) == before
    assert files() == before_files
    assert "비밀 설정".encode() not in database_bytes()
    # The check itself sees a committed write.
    conn.execute("UPDATE card SET source_notes = '비밀 설정 확인' WHERE id = 'c_teo'")
    assert "비밀 설정 확인".encode() in database_bytes()


def test_drafts_need_token(client: TestClient) -> None:
    assert client.post("/api/v1/works/w_01/drafts", json={"type": "world"}).status_code == 401
    assert client.get("/api/v1/drafts/dr_x").status_code == 401
