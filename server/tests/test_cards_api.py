"""Cards over HTTP: list and search, read, references, completeness, region position, 423."""

import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from aiplot.db.connection import connect
from aiplot.db.migrate import init_db
from aiplot.main import create_app
from tests.test_cards import character, fixture, region, save, story

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


def get(client: TestClient, path: str) -> Any:
    response = client.get(f"/api/v1{path}", headers=AUTH)
    assert response.status_code == 200, response.json()
    return response.json()


def error(response: Any) -> tuple[int, str]:
    return response.status_code, response.json()["code"]


def test_list_filter_and_search(client: TestClient, conn: sqlite3.Connection) -> None:
    save(conn, character("c_leo", "레오나르도", relations=[]))
    save(conn, character("c_teo", "테오", relations=[]))
    save(conn, region("c_le", "레몬 숲"))
    save(conn, fixture("character", id="c_x", work_id="w_02", name="레오"))

    def ids(query: str) -> list[str]:
        return [c["id"] for c in get(client, f"/works/w_01/cards{query}")["cards"]]

    assert ids("") == ["c_leo", "c_teo", "c_le"]
    assert ids("?type=character") == ["c_leo", "c_teo"]
    assert sorted(ids("?q=레")) == ["c_le", "c_leo"]
    assert ids("?q=레&type=region") == ["c_le"]
    assert ids("?q=%20") == ["c_leo", "c_teo", "c_le"]
    region_card = get(client, "/works/w_01/cards?type=region")["cards"][0]
    assert region_card["position"] is None
    bad = client.get("/api/v1/works/w_01/cards?type=scene", headers=AUTH)
    assert error(bad) == (422, "VALIDATION_ERROR")
    missing = client.get("/api/v1/works/w_nope/cards", headers=AUTH)
    assert error(missing) == (404, "WORK_NOT_FOUND")


def test_get_one(client: TestClient, conn: sqlite3.Connection) -> None:
    saved = save(conn, fixture("character"))
    assert get(client, "/cards/c_teo") == saved.model_dump(mode="json")
    assert error(client.get("/api/v1/cards/c_nope", headers=AUTH)) == (404, "CARD_NOT_FOUND")


def refs(client: TestClient, card_id: str) -> set[tuple[str, str]]:
    found = get(client, f"/cards/{card_id}/references")["references"]
    return {(r["card_id"], r["field"]) for r in found}


def test_references_come_from_relation_tables(client: TestClient, conn: sqlite3.Connection) -> None:
    story(conn)
    save(conn, character("c_mira", "미라", origin_region_id="c_port", relations=[]))
    save(
        conn,
        character("c_teo", "테오", relations=[{"target_id": "c_mira", "relation": "소꿉친구"}]),
    )
    milestone = conn.execute('SELECT id FROM milestone ORDER BY "order"').fetchone()[0]
    part = fixture("part", id="c_part1")
    part["data"] = {**part["data"], "fulfills": [milestone]}
    save(conn, part)
    ep2 = fixture("episode", id="c_ep2", name="2화")
    ep2["data"] = {
        **ep2["data"],
        "characters": ["c_teo"],
        "fulfills": [],
        "locations": {"main": "c_isle", "others": []},
        "foreshadowing": {"plants": [], "payoffs": ["fs_scar"]},
    }
    episode = fixture("episode")
    episode["data"] = {
        **episode["data"],
        "fulfills": [milestone],
        "locations": {"main": "c_port", "others": ["c_isle"]},
        "links": {"prev": None, "next": "c_ep2", "causes": ["c_ep2"]},
    }
    # Episode 2 exists before episode 1 links to it, and pays off its plant after.
    save(conn, ep2)
    save(conn, episode)
    save(conn, ep2)

    assert refs(client, "c_mira") == {("c_teo", "relations"), ("c_ep1", "characters")}
    assert refs(client, "c_port") == {
        ("c_mira", "origin_region_id"),
        ("c_teo", "origin_region_id"),
        ("c_tide", "related"),
        ("c_ep1", "locations.main"),
    }
    assert refs(client, "c_isle") == {("c_ep1", "locations.others"), ("c_ep2", "locations.main")}
    assert refs(client, "c_tide") == {("c_ep1", "world"), ("c_ep2", "world")}
    assert refs(client, "c_part1") == {("c_ep1", "part_id"), ("c_ep2", "part_id")}
    assert refs(client, "c_main") == {("c_part1", "fulfills"), ("c_ep1", "fulfills")}
    assert refs(client, "c_ep2") == {("c_ep1", "links.next"), ("c_ep1", "links.causes")}
    assert refs(client, "c_ep1") == {("c_ep2", "links.prev"), ("c_ep2", "foreshadowing.payoffs")}
    found = get(client, "/cards/c_mira/references")["references"]
    assert {"card_id": "c_teo", "type": "character", "name": "테오", "field": "relations"} in found
    missing = client.get("/api/v1/cards/c_nope/references", headers=AUTH)
    assert error(missing) == (404, "CARD_NOT_FOUND")


def test_completeness(client: TestClient, conn: sqlite3.Connection) -> None:
    story(conn)
    first, second = [r[0] for r in conn.execute('SELECT id FROM milestone ORDER BY "order"')][:2]
    part = fixture("part", id="c_part1")
    part["data"] = {**part["data"], "fulfills": [first]}
    save(conn, part)
    save(conn, fixture("character-undecided", id="c_vague"))
    episode = fixture("episode")
    episode["data"] = {**episode["data"], "fulfills": [first]}
    save(conn, episode)

    panel = get(client, "/works/w_01/completeness")
    assert [(m["id"], m["parts"], m["episodes"]) for m in panel["milestones"]][:2] == [
        (first, ["c_part1"], ["c_ep1"]),
        (second, [], []),
    ]
    assert panel["foreshadowing"] == [
        {
            "id": "fs_scar",
            "text": "테오의 왼손 흉터",
            "plant_episode_id": "c_ep1",
            "payoff_episode_id": None,
        }
    ]
    assert [c["card_id"] for c in panel["incomplete"]] == ["c_vague"]
    assert get(client, "/works/w_02/completeness") == {
        "milestones": [],
        "foreshadowing": [],
        "incomplete": [],
    }
    missing = client.get("/api/v1/works/w_nope/completeness", headers=AUTH)
    assert error(missing) == (404, "WORK_NOT_FOUND")


def patch(client: TestClient, card_id: str, body: object) -> Any:
    return client.patch(f"/api/v1/cards/{card_id}", headers=AUTH, json=body)


def test_only_a_region_position_is_edited(client: TestClient, conn: sqlite3.Connection) -> None:
    save(conn, region("c_port", "북부 항구"))
    save(conn, fixture("character"))
    response = patch(client, "c_port", {"map_x": 12.5, "map_y": -3})
    assert response.status_code == 200, response.json()
    assert response.json()["position"] == {"map_x": 12.5, "map_y": -3}
    assert get(client, "/cards/c_port")["position"] == {"map_x": 12.5, "map_y": -3}
    before = get(client, "/cards/c_port")

    # Any other field, any other card type: never a direct card edit (§6).
    for body in ({"map_x": 1, "map_y": 2, "name": "새 이름"}, {"name": "새 이름"}, {"map_x": 1}):
        assert error(patch(client, "c_port", body)) == (422, "VALIDATION_ERROR")
    # Only finite coordinates: NaN would be stored as no position, Infinity breaks the map.
    for raw in ('{"map_x": NaN, "map_y": 1}', '{"map_x": 1, "map_y": -Infinity}'):
        response = client.patch(
            "/api/v1/cards/c_port",
            headers={**AUTH, "Content-Type": "application/json"},
            content=raw,
        )
        assert error(response) == (422, "VALIDATION_ERROR")
    assert error(patch(client, "c_port", {"map_x": 2e9, "map_y": 0})) == (422, "VALIDATION_ERROR")
    assert error(patch(client, "c_teo", {"map_x": 1, "map_y": 2})) == (422, "CARD_NOT_REGION")
    assert error(patch(client, "c_nope", {"map_x": 1, "map_y": 2})) == (404, "CARD_NOT_FOUND")
    assert get(client, "/cards/c_port") == before


def test_locked_stage_rejects_the_map(client: TestClient, conn: sqlite3.Connection) -> None:
    save(conn, region("c_port", "북부 항구"))
    conn.execute("UPDATE work SET stage = 2, locked_stage = 1 WHERE id = 'w_01'")
    assert error(patch(client, "c_port", {"map_x": 1, "map_y": 2})) == (423, "STAGE_LOCKED")
    assert get(client, "/cards/c_port")["position"] is None
    # Reading stays open.
    assert len(get(client, "/works/w_01/cards")["cards"]) == 1


def test_cards_need_token(client: TestClient, conn: sqlite3.Connection) -> None:
    save(conn, region("c_port", "북부 항구"))
    for method, path in (
        ("GET", "/api/v1/works/w_01/cards"),
        ("GET", "/api/v1/works/w_01/completeness"),
        ("GET", "/api/v1/cards/c_port"),
        ("GET", "/api/v1/cards/c_port/references"),
        ("PATCH", "/api/v1/cards/c_port"),
    ):
        assert client.request(method, path, json={"map_x": 1, "map_y": 2}).status_code == 401
