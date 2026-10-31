"""Deleting cards and 되돌리기 (§8, §16): everything a delete removes or changes comes back."""

import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from aiplot.db import cards as cards_db
from aiplot.db.connection import connect
from aiplot.db.migrate import init_db
from aiplot.main import create_app
from aiplot.services.trash import Trash
from tests.test_cards import character, fixture, region, save, story

TOKEN = "test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


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
def clock() -> Clock:
    return Clock()


@pytest.fixture
def client(tmp_path: Path, conn: sqlite3.Connection, clock: Clock) -> TestClient:
    app = create_app(token=TOKEN, db_path=tmp_path / "data" / "aiplot.db")
    app.state.trash = Trash(clock=clock)
    return TestClient(app)


def dump(conn: sqlite3.Connection) -> dict[str, list[tuple[Any, ...]]]:
    """Every row of every table but FTS internals, for before/after comparison."""
    tables = [
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'card_name%' "
            "AND name NOT LIKE 'sqlite_%'"
        )
    ]
    return {t: sorted(tuple(r) for r in conn.execute(f"SELECT * FROM {t}")) for t in tables}


def delete(client: TestClient, card_id: str, query: str = "") -> Any:
    return client.delete(f"/api/v1/cards/{card_id}{query}", headers=AUTH)


def restore(client: TestClient, card_id: str) -> Any:
    return client.post(f"/api/v1/cards/{card_id}/restore", headers=AUTH)


def error(response: Any) -> tuple[int, str]:
    return response.status_code, response.json()["code"]


def status(conn: sqlite3.Connection, card_id: str) -> str:
    return str(conn.execute("SELECT status FROM card WHERE id = ?", (card_id,)).fetchone()[0])


def episode(card_id: str, **data: Any) -> dict[str, Any]:
    value = fixture("episode", id=card_id, name=card_id)
    value["data"] = {
        **value["data"],
        "fulfills": [],
        "links": {"prev": None, "next": None, "causes": []},
        "foreshadowing": {"plants": [], "payoffs": []},
        **data,
    }
    return value


def world(conn: sqlite3.Connection) -> None:
    """A story with linked episodes, foreshadowing across them and filled milestones."""
    story(conn)
    save(conn, character("c_mira", "미라", origin_region_id="c_port", relations=[]))
    save(
        conn,
        character("c_teo", "테오", relations=[{"target_id": "c_mira", "relation": "친구"}]),
    )
    save(conn, region("c_cove", "작은 만", parent_id="c_port"))
    milestone = conn.execute('SELECT id FROM milestone ORDER BY "order"').fetchone()[0]
    part = fixture("part", id="c_part1")
    part["data"] = {**part["data"], "fulfills": [milestone]}
    save(conn, part)
    save(conn, fixture("part", id="c_part2", name="2부"))
    for card_id in ("c_e1", "c_e2", "c_e3"):
        save(conn, episode(card_id))
    save(
        conn,
        episode(
            "c_e1",
            fulfills=[milestone],
            links={"prev": None, "next": "c_e2", "causes": ["c_e3"]},
            foreshadowing={"plants": [{"id": "fs_a", "text": "편지"}], "payoffs": []},
        ),
    )
    save(
        conn,
        episode(
            "c_e2",
            characters=["c_mira"],
            links={"prev": "c_e1", "next": "c_e3", "causes": []},
            foreshadowing={"plants": [{"id": "fs_b", "text": "열쇠"}], "payoffs": ["fs_a"]},
        ),
    )
    save(
        conn,
        episode(
            "c_e3",
            links={"prev": "c_e2", "next": None, "causes": []},
            foreshadowing={"plants": [], "payoffs": ["fs_b"]},
        ),
    )


@pytest.mark.parametrize("card_id", ["c_mira", "c_port", "c_main", "c_e2", "c_tide", "c_e1"])
def test_restore_brings_back_every_row(
    client: TestClient, conn: sqlite3.Connection, card_id: str
) -> None:
    world(conn)
    before = dump(conn)
    created = [r[0] for r in conn.execute("SELECT id FROM card ORDER BY rowid")]
    response = delete(client, card_id)
    assert response.status_code == 200, response.json()
    assert response.json()["deleted"] == [card_id]
    assert response.json()["restore_until"].endswith("Z")
    after = dump(conn)
    assert all(card_id not in row for rows in after.values() for row in rows), card_id
    response = restore(client, card_id)
    assert response.status_code == 200, response.json()
    assert response.json()["id"] == card_id
    assert dump(conn) == before
    # Back in its place in creation order (lists and the dex keep their order).
    assert [r[0] for r in conn.execute("SELECT id FROM card ORDER BY rowid")] == created


def test_delete_updates_status_and_search(client: TestClient, conn: sqlite3.Connection) -> None:
    world(conn)
    assert status(conn, "c_e2") == "complete"
    # Episode 2's only character: without it the episode is incomplete.
    save(
        conn,
        episode(
            "c_e2", characters=["c_mira"], links={"prev": "c_e1", "next": "c_e3", "causes": []}
        ),
    )
    delete(client, "c_mira")
    assert status(conn, "c_e2") == "incomplete"
    assert [r.id for r in cards_db.search_names(conn, "w_01", "미라")] == []
    restore(client, "c_mira")
    assert status(conn, "c_e2") == "complete"
    assert [r.id for r in cards_db.search_names(conn, "w_01", "미라")] == ["c_mira"]


def order(conn: sqlite3.Connection) -> list[tuple[Any, ...]]:
    return [
        tuple(r)
        for r in conn.execute(
            "SELECT from_id, to_id FROM episode_link WHERE kind = 'order' ORDER BY 1"
        )
    ]


def test_reconnect_links_the_neighbours(client: TestClient, conn: sqlite3.Connection) -> None:
    world(conn)
    before = dump(conn)
    delete(client, "c_e2", "?reconnect=true")
    assert order(conn) == [("c_e1", "c_e3")]
    restore(client, "c_e2")
    assert dump(conn) == before
    delete(client, "c_e2")
    assert order(conn) == []


def parts(conn: sqlite3.Connection) -> list[tuple[Any, ...]]:
    return [
        tuple(r)
        for r in conn.execute('SELECT card_id, part_id, "order" FROM episode ORDER BY card_id')
    ]


def test_part_with_episodes_asks_where_they_go(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    world(conn)
    save(conn, episode("c_e9", part_id="c_part2", order=1))
    before = dump(conn)
    assert error(delete(client, "c_part1")) == (409, "PART_HAS_EPISODES")
    for bad in (
        "?episodes=keep",
        "?episodes=move:c_part1",
        "?episodes=move:c_e1",
        "?episodes=move:c_nope",
    ):
        assert error(delete(client, "c_part1", bad)) == (422, "EPISODES_TARGET_INVALID")
    assert dump(conn) == before

    response = delete(client, "c_part1", "?episodes=move:c_part2")
    assert response.json()["deleted"] == ["c_part1"]
    # Appended after the target's own episodes, in their old order.
    assert parts(conn) == [
        ("c_e1", "c_part2", 2),
        ("c_e2", "c_part2", 3),
        ("c_e3", "c_part2", 4),
        ("c_e9", "c_part2", 1),
    ]
    restore(client, "c_part1")
    assert dump(conn) == before

    response = delete(client, "c_part1", "?episodes=delete")
    assert response.json()["deleted"] == ["c_part1", "c_e1", "c_e2", "c_e3"]
    assert parts(conn) == [("c_e9", "c_part2", 1)]
    restore(client, "c_part1")
    assert dump(conn) == before


def test_an_empty_part_needs_no_choice(client: TestClient, conn: sqlite3.Connection) -> None:
    world(conn)
    assert delete(client, "c_part2").status_code == 200


def test_restore_window_and_once(
    client: TestClient, conn: sqlite3.Connection, clock: Clock
) -> None:
    world(conn)
    delete(client, "c_tide")
    clock.now += 11
    assert error(restore(client, "c_tide")) == (410, "RESTORE_EXPIRED")
    delete(client, "c_mira")
    assert restore(client, "c_mira").status_code == 200
    assert error(restore(client, "c_mira")) == (410, "RESTORE_EXPIRED")
    assert error(restore(client, "c_never")) == (410, "RESTORE_EXPIRED")


def test_restore_takes_a_new_rowid_if_its_old_one_was_reused(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    world(conn)
    last = conn.execute("SELECT id FROM card ORDER BY rowid DESC LIMIT 1").fetchone()[0]
    delete(client, last)
    save(conn, character("c_new", "새 인물", relations=[]))
    assert restore(client, last).status_code == 200
    ids = [r[0] for r in conn.execute("SELECT id FROM card ORDER BY rowid")]
    assert ids[-2:] == ["c_new", last]
    assert [r.id for r in cards_db.search_names(conn, "w_01", "새")] == ["c_new"]


def test_restore_skips_what_is_gone_meanwhile(client: TestClient, conn: sqlite3.Connection) -> None:
    world(conn)
    delete(client, "c_e2")
    delete(client, "c_mira")
    # Teo's relation to Mira and her place in episode 2 cannot come back without her.
    assert restore(client, "c_e2").status_code == 200
    assert (
        conn.execute("SELECT count(*) FROM episode_character WHERE episode_id = 'c_e2'").fetchone()[
            0
        ]
        == 0
    )
    assert status(conn, "c_e2") == "incomplete"
    assert order(conn) == [("c_e1", "c_e2"), ("c_e2", "c_e3")]
    # A part gone meanwhile leaves the episode without one, but the episode is whole.
    delete(client, "c_e3")
    delete(client, "c_part1", "?episodes=move:c_part2")
    delete(client, "c_part2", "?episodes=delete")
    assert restore(client, "c_e3").status_code == 200
    assert parts(conn) == [("c_e3", None, 1)]


def test_restored_episode_keeps_its_plant_when_the_payoff_is_gone(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    world(conn)
    delete(client, "c_e1")
    delete(client, "c_e2")
    assert restore(client, "c_e1").status_code == 200
    # fs_a is episode 1's own; only the payoff in the deleted episode 2 is skipped.
    found = conn.execute(
        "SELECT id, plant_episode_id, payoff_episode_id FROM foreshadowing ORDER BY id"
    ).fetchall()
    assert [tuple(row) for row in found] == [("fs_a", "c_e1", None)]


def test_locked_stage_rejects_delete_and_restore(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    world(conn)
    delete(client, "c_tide")
    conn.execute("UPDATE work SET stage = 2, locked_stage = 1 WHERE id = 'w_01'")
    assert error(delete(client, "c_mira")) == (423, "STAGE_LOCKED")
    assert error(restore(client, "c_tide")) == (423, "STAGE_LOCKED")
    assert conn.execute("SELECT count(*) FROM card WHERE id = 'c_mira'").fetchone()[0] == 1


def test_not_found_and_token(client: TestClient, conn: sqlite3.Connection) -> None:
    assert error(delete(client, "c_nope")) == (404, "CARD_NOT_FOUND")
    assert client.delete("/api/v1/cards/c_nope").status_code == 401
    assert client.post("/api/v1/cards/c_nope/restore").status_code == 401
