"""Saving cards: relation rows (§14), status (§15), search, and what stays the server's."""

import copy
import json
import sqlite3
from pathlib import Path
from typing import Any

import pytest

from aiplot.db import cards as cards_db
from aiplot.db.connection import connect
from aiplot.db.migrate import init_db
from aiplot.generated.card.card import Card
from aiplot.services import cards
from aiplot.services.works import WorkNotFoundError

FIXTURES = Path(__file__).resolve().parents[2] / "schemas" / "fixtures" / "card" / "card"


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    path = tmp_path / "data" / "aiplot.db"
    init_db(path)
    conn = connect(path)
    for work_id in ("w_01", "w_02"):
        conn.execute(
            "INSERT INTO work (id, title, updated_at) VALUES (?, ?, '2026-10-31T00:00:00Z')",
            (work_id, work_id),
        )
    return conn


def fixture(file: str, /, **changes: Any) -> dict[str, Any]:
    """A valid card fixture (schemas/fixtures/card/card/<file>.valid.json) with changes."""
    path = FIXTURES / f"{file}.valid.json"
    value: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    if value["type"] == "region":
        # Not placed yet: the map sets it, a save never does.
        value["position"] = None
    value.update(changes)
    return value


def card(value: dict[str, Any]) -> Card:
    return cards.CARD.validate_python(value)


def save(conn: sqlite3.Connection, value: dict[str, Any]) -> Card:
    return cards.save(conn, card(value))


def rows(conn: sqlite3.Connection, sql: str, *args: Any) -> list[tuple[Any, ...]]:
    return [tuple(row) for row in conn.execute(sql, args).fetchall()]


def region(card_id: str, name: str, work_id: str = "w_01", **data: Any) -> dict[str, Any]:
    value = fixture("region", id=card_id, name=name, work_id=work_id)
    value["data"] = {**value["data"], "links": [], **data}
    return value


def character(card_id: str, name: str, **data: Any) -> dict[str, Any]:
    value = fixture("character", id=card_id, name=name)
    value["data"] = {**value["data"], **data}
    return value


def test_round_trip_keeps_card_and_computes_status(conn: sqlite3.Connection) -> None:
    value = fixture("character", status="incomplete")
    saved = save(conn, value)
    assert saved.status == "complete"
    assert saved.model_dump(mode="json") == {**value, "status": "complete"}
    assert cards.get(conn, "c_missing") is None


def test_status_follows_required_fields(conn: sqlite3.Connection) -> None:
    assert save(conn, fixture("character-undecided")).status == "incomplete"
    two = character("c_two", "둘", speech={"description": "짧다", "examples": ["a", "b"]})
    assert save(conn, two).status == "incomplete"
    blank = character("c_blank", "  ")
    assert save(conn, blank).status == "incomplete"
    assert save(conn, fixture("world")).status == "complete"
    assert save(conn, fixture("world-undecided")).status == "incomplete"
    assert save(conn, fixture("part")).status == "complete"
    # Parts and the main story need no name (§15).
    assert save(conn, fixture("part", id="c_part9", name=None)).status == "complete"
    assert save(conn, fixture("main-story", name=None)).status == "complete"


def test_character_relations_stay_inside_the_work(conn: sqlite3.Connection) -> None:
    save(conn, region("c_port", "북부 항구"))
    save(conn, region("c_far", "먼 곳", work_id="w_02"))
    save(conn, character("c_mira", "미라", relations=[]))
    save(conn, fixture("character", id="c_other", work_id="w_02", name="남"))
    teo = character(
        "c_teo",
        "테오",
        origin_region_id="c_far",
        relations=[
            {"target_id": "c_mira", "relation": "소꿉친구"},
            {"target_id": "c_other", "relation": "다른 작품"},
            {"target_id": "c_teo", "relation": "자기 자신"},
            {"target_id": "c_ghost", "relation": "없는 카드"},
        ],
    )
    saved = save(conn, teo)
    # The data keeps what was generated; only real references become rows (§6).
    assert len(saved.data.relations) == 4  # type: ignore[union-attr]
    assert rows(conn, "SELECT to_id, relation FROM char_relation WHERE from_id = 'c_teo'") == [
        ("c_mira", "소꿉친구")
    ]
    assert rows(conn, "SELECT origin_region_id FROM character WHERE card_id = 'c_teo'") == [(None,)]
    save(conn, {**teo, "data": {**teo["data"], "origin_region_id": "c_port", "relations": []}})
    assert rows(conn, "SELECT origin_region_id FROM character WHERE card_id = 'c_teo'") == [
        ("c_port",)
    ]
    assert rows(conn, "SELECT * FROM char_relation WHERE from_id = 'c_teo'") == []


def test_region_links_and_position(conn: sqlite3.Connection) -> None:
    save(conn, region("c_capital", "수도"))
    port = fixture("region")
    saved = save(conn, port)
    assert saved.position is None  # type: ignore[union-attr]
    assert rows(
        conn,
        "SELECT to_id, travel_value, travel_unit, travel_mode, direction FROM region_link",
    ) == [("c_capital", 3.0, "day", "말", "남")]
    # The map owns the position; regenerating the card keeps it (§8).
    cards_db.set_region_position(conn, "c_port", 120.5, -40)
    resaved = save(conn, {**port, "name": "북쪽 항구"})
    assert resaved.position is not None  # type: ignore[union-attr]
    assert resaved.position.model_dump() == {"map_x": 120.5, "map_y": -40}  # type: ignore[union-attr]


def story(conn: sqlite3.Connection) -> None:
    """Main story with two milestones, a part, regions, characters and a world card."""
    save(conn, fixture("main-story", id="c_main"))
    save(conn, fixture("part", id="c_part1"))
    save(conn, region("c_port", "북부 항구"))
    save(conn, region("c_isle", "섬"))
    save(conn, character("c_teo", "테오", relations=[]))
    save(conn, character("c_mira", "미라", relations=[]))
    save(conn, fixture("world", id="c_tide"))


def test_episode_rows_and_status(conn: sqlite3.Connection) -> None:
    story(conn)
    milestone = rows(conn, 'SELECT id FROM milestone ORDER BY "order"')[0][0]
    ep2 = fixture("episode", id="c_ep2", name="2화")
    ep2["data"] = {**ep2["data"], "foreshadowing": {"plants": [], "payoffs": []}}
    save(conn, ep2)
    episode = fixture("episode")
    episode["data"] = {
        **episode["data"],
        "fulfills": [milestone, "ms_ghost"],
        "locations": {"main": "c_port", "others": ["c_isle", "c_port"]},
        "links": {"prev": None, "next": "c_ep2", "causes": ["c_ep2", "c_ghost"]},
    }
    saved = save(conn, episode)
    assert saved.status == "complete"
    assert rows(conn, "SELECT part_id, \"order\" FROM episode WHERE card_id = 'c_ep1'") == [
        ("c_part1", 1)
    ]
    assert rows(
        conn, "SELECT card_id FROM episode_character WHERE episode_id = 'c_ep1' ORDER BY card_id"
    ) == [("c_mira",), ("c_teo",)]
    assert rows(
        conn, "SELECT card_id, main FROM episode_region WHERE episode_id = 'c_ep1' ORDER BY main"
    ) == [("c_isle", 0), ("c_port", 1)]
    assert rows(conn, "SELECT card_id FROM episode_world WHERE episode_id = 'c_ep1'") == [
        ("c_tide",)
    ]
    assert rows(conn, "SELECT from_id, to_id, kind FROM episode_link ORDER BY kind") == [
        ("c_ep1", "c_ep2", "cause"),
        ("c_ep1", "c_ep2", "order"),
    ]
    assert rows(conn, "SELECT milestone_id FROM milestone_fill WHERE card_id = 'c_ep1'") == [
        (milestone,)
    ]
    assert rows(conn, "SELECT id, plant_episode_id, payoff_episode_id FROM foreshadowing") == [
        ("fs_scar", "c_ep1", None)
    ]

    # Paid off in episode 2; an unknown id is not.
    ep2["data"] = {
        **ep2["data"],
        "foreshadowing": {"plants": [], "payoffs": ["fs_scar", "fs_ghost"]},
    }
    save(conn, ep2)
    assert rows(conn, "SELECT payoff_episode_id FROM foreshadowing WHERE id = 'fs_scar'") == [
        ("c_ep2",)
    ]

    # Without characters, a main location or a stage summary it is incomplete.
    for data in (
        {"characters": ["c_ghost"]},
        {"locations": {"main": None, "others": ["c_port"]}},
        {
            "structure": {
                **episode["data"]["structure"],
                "stages": [
                    {**stage, "summary": None if i == 0 else stage["summary"]}
                    for i, stage in enumerate(episode["data"]["structure"]["stages"])
                ],
            }
        },
    ):
        changed = copy.deepcopy(episode)
        changed["data"].update(data)
        assert save(conn, changed).status == "incomplete"


def test_milestones_replace_and_take_their_fills(conn: sqlite3.Connection) -> None:
    story(conn)
    main = fixture("main-story", id="c_main")
    first, second = main["data"]["milestones"][:2]
    part = fixture("part", id="c_part1")
    part["data"] = {**part["data"], "fulfills": [first["id"], second["id"]]}
    save(conn, part)
    assert rows(conn, "SELECT main_id FROM part WHERE card_id = 'c_part1'") == [("c_main",)]
    save(conn, {**main, "data": {**main["data"], "milestones": [first]}})
    assert rows(conn, "SELECT milestone_id FROM milestone_fill") == [(first["id"],)]
    emptied = save(conn, {**main, "data": {**main["data"], "milestones": []}})
    assert emptied.status == "incomplete"


def test_conflicts(conn: sqlite3.Connection) -> None:
    save(conn, fixture("main-story", id="c_main"))
    with pytest.raises(cards.CardConflictError):
        save(conn, fixture("main-story", id="c_main2"))
    with pytest.raises(cards.CardConflictError):
        save(conn, fixture("world", id="c_main"))
    with pytest.raises(cards.CardConflictError):
        save(conn, fixture("main-story", id="c_main", work_id="w_02"))
    with pytest.raises(WorkNotFoundError):
        save(conn, fixture("world", work_id="w_nope"))
    # Another work's milestone or another episode's foreshadowing is never taken over.
    with pytest.raises(cards.CardConflictError):
        save(conn, fixture("main-story", id="c_othermain", work_id="w_02"))
    save(conn, fixture("episode"))
    with pytest.raises(cards.CardConflictError):
        save(conn, fixture("episode", id="c_ep9"))
    # Nothing of the failed saves stayed.
    assert rows(conn, "SELECT id FROM card ORDER BY id") == [("c_ep1",), ("c_main",)]
    assert rows(conn, "SELECT DISTINCT main_id FROM milestone") == [("c_main",)]


def test_name_search_matches_word_prefixes(conn: sqlite3.Connection) -> None:
    save(conn, character("c_leo", "레오나르도 다빈치", relations=[]))
    save(conn, character("c_teo", "테오", relations=[]))
    save(conn, region("c_le", "레몬 숲"))
    save(conn, fixture("character", id="c_x", work_id="w_02", name="레오"))

    def names(query: str, card_type: str | None = None) -> list[str]:
        return [r.name or "" for r in cards_db.search_names(conn, "w_01", query, card_type)]

    assert sorted(names("레")) == ["레몬 숲", "레오나르도 다빈치"]
    assert names("레오") == ["레오나르도 다빈치"]
    assert names("다빈") == ["레오나르도 다빈치"]
    assert names("레", "region") == ["레몬 숲"]
    assert names("나르") == []
    # FTS syntax in the query is plain text.
    assert names('"레" OR 테') == []
    assert names("   ") == []
    save(conn, character("c_teo", "레아", relations=[]))
    assert sorted(names("레아")) == ["레아"]


def order(conn: sqlite3.Connection) -> list[tuple[Any, ...]]:
    return rows(conn, "SELECT from_id, to_id FROM episode_link WHERE kind = 'order' ORDER BY 1, 2")


def episode_with(card_id: str, prev: str | None, next_id: str | None) -> dict[str, Any]:
    value = fixture("episode", id=card_id, name=card_id)
    value["data"] = {
        **value["data"],
        "links": {"prev": prev, "next": next_id, "causes": []},
        "foreshadowing": {"plants": [], "payoffs": []},
    }
    return value


def test_order_links_keep_one_prev_and_next(conn: sqlite3.Connection) -> None:
    for card_id in ("c_e1", "c_e2", "c_e3"):
        save(conn, episode_with(card_id, None, None))
    save(conn, episode_with("c_e1", None, "c_e2"))
    # Saving episode 2 without a prev of its own leaves episode 1's link alone.
    save(conn, episode_with("c_e2", None, None))
    assert order(conn) == [("c_e1", "c_e2")]
    # A new placement wins: episode 3 now follows 1, so 1 -> 2 goes.
    save(conn, episode_with("c_e3", "c_e1", None))
    assert order(conn) == [("c_e1", "c_e3")]
    save(conn, episode_with("c_e2", None, "c_e1"))
    assert order(conn) == [("c_e1", "c_e3"), ("c_e2", "c_e1")]
    # Withdrawing its own claim removes only that link.
    save(conn, episode_with("c_e3", None, None))
    assert order(conn) == [("c_e2", "c_e1")]
