"""The development seed (scripts/seed_academy.py): the sample work's cards, their relation rows,
and a second run that adds nothing."""

import importlib.util
import sqlite3
from collections import Counter
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest

from aiplot.db.connection import connect
from aiplot.generated.card.card import (
    CharacterCard,
    EpisodeCard,
    PartCard,
    RegionCard,
    WorldCard,
)
from aiplot.services import cards

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "seed_academy.py"

RELATION_TABLES = (
    "char_relation",
    "world_relation",
    "region_link",
    "episode_character",
    "episode_region",
    "episode_world",
    "episode_link",
    "milestone",
    "milestone_fill",
    "foreshadowing",
)


def load_main() -> Callable[[Path], str]:
    spec = importlib.util.spec_from_file_location("seed_academy", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    main: Callable[[Path], str] = module.main
    return main


@pytest.fixture
def seeded(tmp_path: Path) -> Iterator[tuple[sqlite3.Connection, str]]:
    work_id = load_main()(tmp_path)
    conn = connect(tmp_path / "data" / "aiplot.db")
    yield conn, work_id
    conn.close()


def pairs(conn: sqlite3.Connection, sql: str) -> set[tuple[Any, ...]]:
    return {tuple(row) for row in conn.execute(sql).fetchall()}


def test_cards_by_type_and_status(seeded: tuple[sqlite3.Connection, str]) -> None:
    conn, work_id = seeded
    found = cards.list_cards(conn, work_id, None, None)
    assert Counter(c.type for c in found) == {
        "world": 15,
        "character": 29,
        "region": 13,
        "main_story": 1,
        "part": 5,
        "episode": 30,
    }
    # As in the setting: 목자 has one speech example, 페더 영애 none; 19 episodes have no
    # structure yet (one of them no main place either).
    incomplete = Counter(c.type for c in found if c.status == "incomplete")
    assert incomplete == {"character": 2, "episode": 19}
    assert {c.id for c in found if c.type == "character" and c.status == "incomplete"} == {
        "c_shepherd",
        "c_feder",
    }


def test_every_reference_has_its_relation_row(seeded: tuple[sqlite3.Connection, str]) -> None:
    conn, work_id = seeded
    found = cards.list_cards(conn, work_id, None, None)
    # The relation tables hold only references that resolved, so each one must match the
    # card data exactly.
    expected: dict[str, set[tuple[Any, ...]]] = {table: set() for table in RELATION_TABLES}
    parents: set[tuple[Any, ...]] = set()
    plants: dict[str, str] = {}
    payoffs: dict[str, str] = {}
    origins: set[tuple[Any, ...]] = set()
    for card in found:
        match card:
            case WorldCard(data=data):
                expected["world_relation"] |= {(card.id, r) for r in data.related}
            case CharacterCard(data=data):
                expected["char_relation"] |= {
                    (card.id, r.target_id, r.relation) for r in data.relations
                }
                origins.add((card.id, data.origin_region_id))
            case RegionCard(data=data):
                expected["region_link"] |= {(card.id, link.target_id) for link in data.links}
                parents.add((card.id, data.parent_id))
            case PartCard(data=data):
                expected["milestone_fill"] |= {(m, card.id) for m in data.fulfills}
            case EpisodeCard(data=data):
                expected["episode_character"] |= {(card.id, c) for c in data.characters}
                if data.locations.main is not None:
                    expected["episode_region"].add((card.id, data.locations.main, 1))
                expected["episode_region"] |= {(card.id, r, 0) for r in data.locations.others}
                expected["episode_world"] |= {(card.id, w) for w in data.world}
                if data.links.prev is not None:
                    expected["episode_link"].add((data.links.prev, card.id, "order"))
                expected["episode_link"] |= {(card.id, c, "cause") for c in data.links.causes}
                expected["milestone_fill"] |= {(m, card.id) for m in data.fulfills}
                plants |= {p.id: card.id for p in data.foreshadowing.plants}
                payoffs |= dict.fromkeys(data.foreshadowing.payoffs, card.id)
    assert (
        pairs(conn, "SELECT from_id, to_id, relation FROM char_relation")
        == (expected["char_relation"])
    )
    assert (
        pairs(conn, "SELECT world_id, card_id FROM world_relation") == (expected["world_relation"])
    )
    assert pairs(conn, "SELECT from_id, to_id FROM region_link") == expected["region_link"]
    assert pairs(conn, "SELECT card_id, parent_region_id FROM region") == parents
    assert pairs(conn, "SELECT card_id, origin_region_id FROM character") == origins
    assert (
        pairs(conn, "SELECT episode_id, card_id FROM episode_character")
        == (expected["episode_character"])
    )
    assert (
        pairs(conn, "SELECT episode_id, card_id, main FROM episode_region")
        == (expected["episode_region"])
    )
    assert (
        pairs(conn, "SELECT episode_id, card_id FROM episode_world") == (expected["episode_world"])
    )
    # 29 order links chain the 30 episodes; the causes point ahead and resolve too.
    links = pairs(conn, "SELECT from_id, to_id, kind FROM episode_link")
    assert links == expected["episode_link"]
    assert Counter(kind for _, _, kind in links) == {"order": 29, "cause": 5}
    assert (
        pairs(conn, "SELECT milestone_id, card_id FROM milestone_fill")
        == (expected["milestone_fill"])
    )
    assert pairs(conn, "SELECT id, plant_episode_id, payoff_episode_id FROM foreshadowing") == {
        (fid, episode, payoffs.get(fid)) for fid, episode in plants.items()
    }
    # Every milestone is in exactly one part; two plants are left open in the setting.
    completeness = cards.completeness(conn, work_id)
    assert len(completeness.milestones) == 7
    assert all(len(m.parts) == 1 for m in completeness.milestones)
    assert {f.id for f in completeness.foreshadowing if f.payoff_episode_id is None} == {
        "fs_song",
        "fs_note",
    }


def test_second_run_adds_nothing(
    seeded: tuple[sqlite3.Connection, str], tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    conn, work_id = seeded

    def snapshot() -> dict[str, int]:
        tables = ("work", "card", *RELATION_TABLES)
        return {t: conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in tables}

    before = snapshot()
    capsys.readouterr()
    assert load_main()(tmp_path) == work_id
    assert "nothing seeded" in capsys.readouterr().out
    assert snapshot() == before
    assert before["work"] == 1
    assert before["card"] == 93
