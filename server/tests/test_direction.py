"""Stage 2 direction in code (§9): scenes cleaned, candidates narrowed, picks cleaned."""

import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from aiplot.db.connection import connect
from aiplot.db.migrate import init_db
from aiplot.generated.roles.pick_output import OutputPick, PickOutput
from aiplot.generated.roles.scene_output import SceneOutput
from aiplot.generated.technique.technique import Technique
from aiplot.services import direction, techniques
from aiplot.services.direction import SERIAL_TECHNIQUES

CATALOG = techniques.load()
BY_ID = {card.id: card for card in CATALOG}


@pytest.fixture
def conn(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    path = tmp_path / "data" / "aiplot.db"
    init_db(path)
    conn = connect(path)
    techniques.sync(conn, CATALOG)
    yield conn
    conn.close()


def technique(number: int, **changes: Any) -> Technique:
    """A real card under another id, with no relations unless given."""
    return Technique.model_validate(
        {
            **CATALOG[0].model_dump(mode="json"),
            "id": f"tech_inf_{number:03d}",
            "category": "inf",
            "scope": ["장면"],
            "effects": ["긴장"],
            "situations": ["사건발생"],
            "pairs_with": [],
            "conflicts_with": [],
            **changes,
        }
    )


def shared(card: Technique, effects: set[str], situations: set[str]) -> tuple[int, int]:
    e = len(effects & set(card.effects))
    return e + len(situations & set(card.situations)), e


def test_serial_cards_are_the_four_direct_always_gets() -> None:
    assert [BY_ID[i].name for i in SERIAL_TECHNIQUES] == [
        "회차 끝 절단",
        "회차 3단 설계",
        "사이다/고구마 완급",
        "전회 연결 도입",
    ]
    assert not any(direction.is_candidate(BY_ID[i]) for i in SERIAL_TECHNIQUES)


@pytest.mark.parametrize(
    ("effects", "situations"),
    [
        (["긴장", "호기심"], ["사건발생"]),
        (["반전", "놀람"], ["비밀"]),
        (["비애"], []),
        ([], ["깨달음", "징조"]),
    ],
)
def test_candidates_rank_by_shared_tags(
    conn: sqlite3.Connection, effects: list[str], situations: list[str]
) -> None:
    found = direction.candidates(conn, effects, situations)
    assert found == direction.narrow(CATALOG, effects, situations)
    assert 0 < len(found) <= 20
    wanted = (set(effects), set(situations))
    for card in found:
        assert {"장면", "회차"} & set(card.scope)
        assert card.id not in SERIAL_TECHNIQUES
        assert shared(card, *wanted)[0] >= 1
    # Most shared tags first, ties by more shared effects, then id.
    keys = [(-shared(c, *wanted)[0], -shared(c, *wanted)[1], c.id) for c in found]
    assert keys == sorted(keys)
    # Every eligible card left out ranks after the last one kept.
    left_out = [
        c for c in CATALOG if direction.is_candidate(c) and shared(c, *wanted)[0] and c not in found
    ]
    if left_out:
        assert len(found) == 20
        assert all(
            (-shared(c, *wanted)[0], -shared(c, *wanted)[1], c.id) > keys[-1] for c in left_out
        )


def test_candidates_leave_out_sentence_arc_and_serial_cards() -> None:
    # Tags every serial card has, so they would share some if they were candidates.
    effects = sorted({e for i in SERIAL_TECHNIQUES for e in BY_ID[i].effects})[:3]
    found = {c.id for c in direction.narrow(CATALOG, effects, [], limit=len(CATALOG))}
    assert found
    assert not found & set(SERIAL_TECHNIQUES)
    assert all({"장면", "회차"} & set(BY_ID[i].scope) for i in found)
    sentence_only = [c for c in CATALOG if set(c.scope) <= {"문장", "아크", "작품"}]
    assert sentence_only
    assert not found & {c.id for c in sentence_only}


def test_narrow_order_and_limit() -> None:
    catalog = [
        technique(1, effects=["긴장"], situations=["비밀"]),  # 1 effect + 1 situation
        technique(2, effects=["긴장", "호기심"], situations=["추격"]),  # 2 effects
        technique(3, effects=["공포"], situations=["비밀", "사건발생"]),  # 2 situations
        technique(4, effects=["긴장"], situations=["추격"]),  # 1 effect
        technique(5, effects=["공포"], situations=["사건발생"]),  # 1 situation
        technique(6, effects=["공포"], situations=["추격"]),  # nothing shared
        technique(7, scope=["문장"], effects=["긴장", "호기심"], situations=["비밀"]),
        technique(8, scope=["아크", "작품"], effects=["긴장", "호기심"], situations=["비밀"]),
        technique(9, scope=["문장", "회차"], effects=["호기심"], situations=["추격"]),
    ]
    effects, situations = ["긴장", "호기심"], ["비밀", "사건발생"]
    ids = [c.id for c in direction.narrow(catalog, effects, situations)]
    assert ids == [
        "tech_inf_002",  # 2 shared, both effects
        "tech_inf_001",  # 2 shared, 1 effect
        "tech_inf_003",  # 2 shared, no effect
        "tech_inf_004",  # 1 shared effect, by id
        "tech_inf_009",
        "tech_inf_005",  # 1 shared situation
    ]
    limited = direction.narrow(catalog, effects, situations, limit=2)
    assert [c.id for c in limited] == ids[:2]
    assert direction.narrow(catalog, [], []) == []


def test_clean_scenes_keeps_stage_scenes_renumbered_with_tags_once() -> None:
    output = SceneOutput.model_validate(
        {
            "scenes": [
                {
                    "scene": 1,
                    "source": "발단",
                    "summary": "가",
                    "effects": ["긴장", "긴장", "호기심"],
                    "situations": ["비밀", "비밀"],
                },
                {"scene": 2, "source": "기", "summary": "나", "effects": [], "situations": []},
                {"scene": 3, "source": "위기", "summary": "다", "effects": [], "situations": []},
                {"scene": 3, "source": "위기", "summary": "라", "effects": [], "situations": []},
            ]
        }
    )
    scenes = direction.clean_scenes(output, ["발단", "전개", "위기", "절정", "결말"])
    assert [(s.scene, s.source, s.summary) for s in scenes] == [
        (1, "발단", "가"),
        (2, "위기", "다"),
        (3, "위기", "라"),
    ]
    assert scenes[0].effects == ["긴장", "호기심"]
    assert scenes[0].situations == ["비밀"]
    assert direction.clean_scenes(output, ["기", "승", "전", "결"])[0].summary == "나"
    assert direction.clean_scenes(output, []) == []


def picks(*entries: tuple[int, list[str]]) -> PickOutput:
    return PickOutput.model_validate(
        {
            "picks": [
                {"rank": rank, "techniques": ids, "reason": f"이유 {n}"}
                for n, (rank, ids) in enumerate(entries)
            ]
        }
    )


def summary(kept: list[OutputPick]) -> list[tuple[int, list[str], str]]:
    return [(p.rank, p.techniques, p.reason) for p in kept]


SCENE = [
    technique(1),
    technique(2, conflicts_with=["tech_inf_003"]),
    technique(3),
    technique(4),
]


def test_clean_picks_drops_unknown_and_repeated_ids() -> None:
    kept = direction.clean_picks(
        picks(
            (1, ["tech_inf_001", "tech_inf_009", "tech_inf_001"]),
            (2, ["tech_inf_008"]),  # nothing left: dropped
            (3, ["tech_inf_004", "tech_inf_003"]),
        ),
        SCENE,
    )
    assert summary(kept) == [
        (1, ["tech_inf_001"], "이유 0"),
        (2, ["tech_inf_004", "tech_inf_003"], "이유 2"),
    ]


def test_clean_picks_drops_conflicts_either_way_and_repeats() -> None:
    kept = direction.clean_picks(
        picks(
            (1, ["tech_inf_002", "tech_inf_003"]),  # 002 lists 003
            (2, ["tech_inf_003", "tech_inf_002", "tech_inf_001"]),  # 003 does not list 002
            (3, ["tech_inf_001", "tech_inf_004"]),
        ),
        SCENE,
    )
    assert summary(kept) == [(1, ["tech_inf_001", "tech_inf_004"], "이유 2")]

    repeated = direction.clean_picks(
        picks(
            (1, ["tech_inf_001", "tech_inf_004"]),
            (2, ["tech_inf_004", "tech_inf_001"]),  # same cards in another order
            (3, ["tech_inf_001", "tech_inf_004", "tech_inf_009"]),  # same once 009 goes
        ),
        SCENE,
    )
    assert summary(repeated) == [(1, ["tech_inf_001", "tech_inf_004"], "이유 0")]


def test_clean_picks_orders_by_rank_keeps_three_and_renumbers() -> None:
    kept = direction.clean_picks(
        picks(
            (3, ["tech_inf_003"]),
            (1, ["tech_inf_009"]),  # unknown: its rank goes to the next
            (2, ["tech_inf_001"]),
        ),
        SCENE,
    )
    assert summary(kept) == [(1, ["tech_inf_001"], "이유 2"), (2, ["tech_inf_003"], "이유 0")]

    # Equal ranks keep the model's order. More than three cannot come from the schema
    # (maxItems 3); the cap still holds for a constructed output.
    many = PickOutput.model_construct(
        picks=[
            OutputPick(rank=2, techniques=[f"tech_inf_00{n}"], reason=str(n)) for n in (4, 3, 2, 1)
        ]
    )
    assert summary(direction.clean_picks(many, SCENE)) == [
        (1, ["tech_inf_004"], "4"),
        (2, ["tech_inf_003"], "3"),
        (3, ["tech_inf_002"], "2"),
    ]


def test_clean_picks_with_real_conflicting_cards(conn: sqlite3.Connection) -> None:
    a, b = BY_ID["tech_cha_001"], BY_ID["tech_voi_010"]
    assert b.id in a.conflicts_with and a.id not in b.conflicts_with
    other = next(c for c in CATALOG if direction.is_candidate(c) and not c.conflicts_with)
    kept = direction.clean_picks(picks((1, [b.id, a.id]), (2, [other.id])), [a, b, other])
    assert summary(kept) == [(1, [other.id], "이유 1")]
