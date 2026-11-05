"""Stage 2 direction in code (§9): scenes cleaned, technique cards recommended."""

import json
import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from aiplot.db.connection import connect
from aiplot.db.migrate import init_db
from aiplot.generated.roles.scene_output import SceneDevices, SceneOutput
from aiplot.generated.technique.technique import Technique
from aiplot.services import direction, techniques
from aiplot.services.direction import RECOMMEND_LIMIT, SERIAL_TECHNIQUES, Recommendation
from aiplot.services.direction_context import Scene

SCHEMAS = Path(__file__).resolve().parents[2] / "schemas" / "technique"
DEVICES = json.loads((SCHEMAS / "technique-device.json").read_text(encoding="utf-8"))["enum"]

CATALOG = techniques.load()
BY_ID = {card.id: card for card in CATALOG}


def devices(*true: str) -> dict[str, bool]:
    return {key: key in true for key in DEVICES}


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
            "devices": [],
            "pairs_with": [],
            "conflicts_with": [],
            **changes,
        }
    )


def key(card: Technique, scene: tuple[set[str], set[str], set[str]]) -> tuple[int, int, str]:
    """The ranking key §9 gives: more shared devices, then more shared tags, then id."""
    wanted_devices, effects, situations = scene
    shared_devices = len(wanted_devices & set(card.devices))
    tags = len(effects & set(card.effects)) + len(situations & set(card.situations))
    return -shared_devices, -tags, card.id


def test_serial_cards_are_the_four_direct_always_gets() -> None:
    assert [BY_ID[i].name for i in SERIAL_TECHNIQUES] == [
        "회차 끝 절단",
        "회차 3단 설계",
        "사이다/고구마 완급",
        "전회 연결 도입",
    ]
    assert not any(direction.is_candidate(BY_ID[i]) for i in SERIAL_TECHNIQUES)


def test_scene_devices_are_the_device_list_in_order() -> None:
    assert list(SceneDevices.model_fields) == DEVICES


@pytest.mark.parametrize(
    ("scene_devices", "effects", "situations"),
    [
        (["knowledge_gap", "overhear"], ["긴장"], ["비밀"]),
        (["past_told"], ["비애"], []),
        ([], ["반전", "놀람"], ["진실폭로"]),
        (["misunderstanding", "humor", "repetition"], [], []),
    ],
)
def test_recommend_ranks_by_shared_devices_then_tags(
    conn: sqlite3.Connection, scene_devices: list[str], effects: list[str], situations: list[str]
) -> None:
    scene = Scene.model_validate(
        {
            "scene": 1,
            "source": "위기",
            "summary": "가",
            "devices": scene_devices,
            "effects": effects,
            "situations": situations,
        }
    )
    found = direction.recommend(conn, scene)
    assert found == direction.rank(CATALOG, scene_devices, effects, situations)
    assert len(found) == RECOMMEND_LIMIT
    assert [r.rank for r in found] == list(range(1, RECOMMEND_LIMIT + 1))
    wanted = (set(scene_devices), set(effects), set(situations))
    cards = [BY_ID[r.technique_id] for r in found]
    for r, card in zip(found, cards, strict=True):
        assert direction.is_candidate(card)
        assert r.devices == [d for d in card.devices if d in scene_devices]
        assert r.effects == [e for e in card.effects if e in effects]
        assert r.situations == [s for s in card.situations if s in situations]
        assert r.devices or r.effects or r.situations
    keys = [key(c, wanted) for c in cards]
    assert keys == sorted(keys)
    # Every candidate left out that shares something ranks after the last one kept.
    shown = {c.id for c in cards}
    left_out = [
        c
        for c in CATALOG
        if direction.is_candidate(c) and c.id not in shown and key(c, wanted)[:2] != (0, 0)
    ]
    assert all(key(c, wanted) > keys[-1] for c in left_out)


def test_rank_order_and_limit() -> None:
    catalog = [
        technique(1, devices=["overhear"], effects=["긴장"], situations=["비밀"]),
        technique(2, devices=["overhear", "knowledge_gap"], effects=["공포"]),
        technique(3, devices=["overhear"], effects=["긴장", "호기심"], situations=["비밀"]),
        technique(4, effects=["긴장", "호기심"], situations=["비밀"]),  # tags only
        technique(5, effects=["공포"], situations=["추격"]),  # nothing shared
        technique(6, scope=["문장"], devices=["overhear", "knowledge_gap"]),
        technique(7, scope=["아크", "작품"], devices=["overhear"]),
        technique(8, effects=["호기심"]),
    ]
    found = direction.rank(catalog, ["overhear", "knowledge_gap"], ["긴장", "호기심"], ["비밀"])
    assert [(r.rank, r.technique_id) for r in found] == [
        (1, "tech_inf_002"),  # 2 shared devices
        (2, "tech_inf_003"),  # 1 device, 3 tags
        (3, "tech_inf_001"),  # 1 device, 2 tags
        (4, "tech_inf_004"),  # no device, 3 tags
        (5, "tech_inf_008"),  # no device, 1 tag
    ]
    assert found[0] == Recommendation(
        rank=1,
        technique_id="tech_inf_002",
        devices=["overhear", "knowledge_gap"],
        effects=[],
        situations=[],
    )
    assert [r.technique_id for r in direction.rank(catalog, ["overhear"], [], [], limit=2)] == [
        "tech_inf_001",
        "tech_inf_002",
    ]
    assert direction.rank(catalog, [], [], []) == []


def test_rank_leaves_out_sentence_arc_and_serial_cards() -> None:
    every = {d for c in CATALOG for d in c.devices}
    effects = sorted({e for i in SERIAL_TECHNIQUES for e in BY_ID[i].effects})
    found = {r.technique_id for r in direction.rank(CATALOG, every, effects, [], len(CATALOG))}
    assert found
    assert not found & set(SERIAL_TECHNIQUES)
    assert all(direction.is_candidate(BY_ID[i]) for i in found)


def scenes(*entries: dict[str, Any]) -> SceneOutput:
    return SceneOutput.model_validate({"scenes": list(entries)})


def entry(number: int, source: str, summary: str, **changes: Any) -> dict[str, Any]:
    return {
        "scene": number,
        "source": source,
        "summary": summary,
        "devices": devices(),
        "effects": ["긴장"],
        "situations": ["위기"],
        **changes,
    }


def test_clean_scenes_keeps_stage_scenes_renumbered_with_tags_once() -> None:
    output = scenes(
        entry(1, "발단", "가", effects=["긴장", "긴장", "호기심"], situations=["비밀", "비밀"]),
        entry(2, "기", "나"),
        entry(3, "위기", "다"),
        entry(3, "위기", "라"),
    )
    kept = direction.clean_scenes(output, ["발단", "전개", "위기", "절정", "결말"])
    assert [(s.scene, s.source, s.summary) for s in kept] == [
        (1, "발단", "가"),
        (2, "위기", "다"),
        (3, "위기", "라"),
    ]
    assert kept[0].effects == ["긴장", "호기심"]
    assert kept[0].situations == ["비밀"]
    assert direction.clean_scenes(output, ["기", "승", "전", "결"])[0].summary == "나"
    assert direction.clean_scenes(output, []) == []


def test_clean_scenes_keeps_the_devices_answered_true_in_list_order() -> None:
    output = scenes(entry(1, "전개", "가", devices=devices("overhear", "knowledge_gap")))
    (scene,) = direction.clean_scenes(output, ["전개"])
    assert scene.devices == ["knowledge_gap", "overhear"]
    assert direction.clean_scenes(scenes(entry(1, "전개", "가")), ["전개"])[0].devices == []


def test_clean_scenes_refuses_an_output_with_too_many_yes_devices() -> None:
    limit = direction.MAX_YES_DEVICES
    at_limit = devices(*DEVICES[:limit])
    over = devices(*DEVICES[: limit + 1])
    kept = direction.clean_scenes(scenes(entry(1, "전개", "가", devices=at_limit)), ["전개"])
    assert len(kept[0].devices) == limit
    # One scene over the limit spoils the whole output, even one from another stage.
    output = scenes(entry(1, "전개", "가"), entry(2, "기", "나", devices=over))
    assert direction.clean_scenes(output, ["전개"]) == []


def test_choice_rules() -> None:
    fits = [c for c in CATALOG if direction.is_candidate(c) and not c.conflicts_with]
    clash = [BY_ID["tech_cha_001"], BY_ID["tech_voi_010"]]
    sentence_only = next(c for c in CATALOG if set(c.scope) == {"문장"})
    assert direction.choice_error(fits[:1]) is None
    assert direction.choice_error(fits[: direction.MAX_CHOSEN]) is None
    assert direction.choice_error(fits[: direction.MAX_CHOSEN + 1]) == "TOO_MANY_TECHNIQUES"
    assert direction.choice_error([fits[0], sentence_only]) == "TECHNIQUE_NOT_CANDIDATE"
    assert direction.choice_error([fits[0], BY_ID[SERIAL_TECHNIQUES[0]]]) == (
        "TECHNIQUE_NOT_CANDIDATE"
    )
    assert all(direction.is_candidate(c) for c in clash)
    assert direction.choice_error(clash) == "TECHNIQUES_CONFLICT"


def test_conflicting_either_way() -> None:
    a, b = BY_ID["tech_cha_001"], BY_ID["tech_voi_010"]
    assert b.id in a.conflicts_with and a.id not in b.conflicts_with
    other = next(c for c in CATALOG if direction.is_candidate(c) and not c.conflicts_with)
    assert direction.conflicting([b, other, a])
    assert not direction.conflicting([a, other])
