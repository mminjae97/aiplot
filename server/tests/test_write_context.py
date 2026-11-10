"""What the write role sees for a beat (§10): matching style sections, cards, state, the story so
far and the beat's instruction."""

# Fixtures imported from other test modules (conn, client, llm, plan) are redefined as test
# parameters by name; that is how pytest passes them.
# ruff: noqa: F811

import sqlite3
from typing import Any

import pytest
from fastapi.testclient import TestClient

from aiplot.db import techniques as techniques_db
from aiplot.llm.style import load_style
from aiplot.services import write_context
from aiplot.services.write_context import newest_within, tail, write_turns
from tests.test_cards import character, fixture, save
from tests.test_direction_roles import block, conn  # noqa: F401
from tests.test_manuscript import chapters, confirmed, write
from tests.test_plan_direct_api import advance
from tests.test_plan_scenes_api import plan  # noqa: F401
from tests.test_plans_api import client, llm  # noqa: F401

STYLE = load_style("webnovel-style", 3)


@pytest.fixture
def written(
    client: TestClient, conn: sqlite3.Connection, plan: dict[str, Any]
) -> list[dict[str, Any]]:
    """The manuscript's chapters once writing started: 1화's two chapters, then 0화's."""
    confirmed(client, conn, plan)
    assert advance(client).status_code == 200
    made: list[dict[str, Any]] = chapters(client)
    return made


def add(conn: sqlite3.Connection, value: dict[str, Any]) -> None:
    """Saves a card as planning would have: the stage is locked by now (§11)."""
    conn.execute("UPDATE work SET stage = 1, locked_stage = 0 WHERE id = 'w_01'")
    save(conn, value)
    conn.execute("UPDATE work SET stage = 3, locked_stage = 2 WHERE id = 'w_01'")


def content(conn: sqlite3.Connection, beat_id: str, **options: Any) -> str:
    [turn] = write_turns(conn, STYLE, beat_id, **options)
    assert turn["role"] == "user"
    return turn["content"]


def test_a_beat_gets_its_style_cards_story_and_instruction(
    conn: sqlite3.Connection, written: list[dict[str, Any]]
) -> None:
    beats = written[0]["beats"]
    first, second = beats[0], beats[1]
    write(conn, first["id"], 1, "안개가 부두를 덮고 있었다.\n\n테오는 밧줄을 쥐었다.")
    text = content(conn, second["id"])
    # The blocks in order; no state yet, so no <상태>.
    order = [text.index(mark) for mark in ("이 비트의 문체", "<참고 카드>", "<원문>", "<지시>")]
    assert order == sorted(order) and order[0] == 0
    assert "<상태>" not in text
    matched = STYLE.for_beat(
        mode=second["mode"],
        focus=second["focus"],
        density=second["density"],
        pov=second["pov"],
        tension=second["tension"],
    )
    assert matched and text.startswith(f"이 비트의 문체\n{matched}\n\n<참고 카드>")
    cards = block(text, "참고 카드")
    assert "인물 테오: 잃어버린 가족을 찾는 귀환자" in cards
    assert '  말투 예시: "됐어." / "따라와." / "그건 내 일이 아니야."' in cards
    assert "  외모: 왼손에 흉터가 있는 20대 남성" in cards
    assert (
        "주 무대 북부 항구: 안개 낀 석조 부두\n  분위기 음울함, 소리 갈매기, 냄새 소금과 생선"
        in cards
    )
    assert "장소 섬: 안개 낀 석조 부두" in cards
    assert "  규칙: 쓸 때마다 체온을 잃는다 (예외: 등대지기 혈통은 대가가 없다)" in cards
    assert "  용어: 물때 = 마법이 가장 강한 시각" in cards
    # Inactive cards and ids never reach the model.
    assert "유령" not in cards and "안개 계약" not in cards and "폐허" not in cards
    assert "c_" not in text and "tech_" not in text
    assert (
        block(text, "원문") == "바로 앞 원고:\n안개가 부두를 덮고 있었다.\n\n테오는 밧줄을 쥐었다."
    )
    lines = block(text, "지시").splitlines()
    assert lines[0] == f"자리: 1화, 비트 2/{len(beats)}"
    assert lines[1].startswith("이 비트가 속한 장면: ")
    assert lines[2:8] == [
        f"시점: {second['pov']}",
        f"서술 방식: {second['mode']}",
        f"초점: {second['focus']}",
        f"묘사량: {second['density']}",
        f"긴장도: {second['tension']} / 5",
        f"분량: 공백 포함 {second['target_chars']}자 안팎",
    ]
    assert lines[8] == f"내용: {second['summary']}"
    assert lines[-1] == f"다음 비트(이번에 쓰지 않는다): {beats[2]['summary']}"


def test_the_first_and_last_beats_say_where_they_are(
    conn: sqlite3.Connection, written: list[dict[str, Any]]
) -> None:
    beats = written[0]["beats"]
    first = content(conn, beats[0]["id"])
    assert f"자리: 1화, 비트 1/{len(beats)} (화의 첫 비트)" in first
    # The work's first beat: nothing was written before it.
    assert block(first, "원문") == "바로 앞 원고:\n(없음: 작품의 첫머리)"
    # A later beat whose earlier ones are not written yet.
    assert block(content(conn, beats[1]["id"]), "원문") == "바로 앞 원고:\n(아직 없음)"
    last = content(conn, beats[-1]["id"])
    assert f"자리: 1화, 비트 {len(beats)}/{len(beats)} (화의 마지막 비트)" in last
    assert last.endswith("다음 비트: 없음 (이 비트에서 화가 끝난다)\n</지시>")


def test_a_beats_cards_give_their_hints_only(
    conn: sqlite3.Connection, written: list[dict[str, Any]]
) -> None:
    beat = next(b for b in written[0]["beats"] if b["techniques"])
    cards = [techniques_db.get(conn, technique_id) for technique_id in beat["techniques"]]
    order = block(content(conn, beat["id"]), "지시")
    for card in cards:
        assert card is not None
        assert f"- {card.prompt_hint}" in order
        # Not the name, and never the example (§9).
        assert card.name not in order and card.example not in order
    assert "쓸 기법:" in order
    plain = next(b for b in written[0]["beats"] if not b["techniques"])
    assert "쓸 기법" not in content(conn, plain["id"])


def test_a_chapters_first_beat_continues_the_chapter_before(
    conn: sqlite3.Connection, written: list[dict[str, Any]]
) -> None:
    ending = written[0]["beats"][-1]["id"]
    write(conn, written[0]["beats"][0]["id"], 1, "첫 비트.")
    write(conn, ending, 1, "옛 판본.")
    write(conn, ending, 2, "휘장 끝이 흔들렸다.")
    opening = written[1]["beats"]
    text = block(content(conn, opening[0]["id"]), "원문")
    # The current versions of the chapter before, in order.
    assert text == "앞 화의 끝 (이 비트는 새 화의 첫머리다):\n첫 비트.\n\n휘장 끝이 흔들렸다."
    # Within a chapter only its own beats count; an unwritten one is skipped.
    write(conn, opening[0]["id"], 1, "2화가 시작됐다.")
    write(conn, opening[2]["id"], 1, "뒤의 비트.")
    assert block(content(conn, opening[1]["id"]), "원문") == "바로 앞 원고:\n2화가 시작됐다."


def test_only_the_end_of_the_manuscript_is_given(
    conn: sqlite3.Connection, written: list[dict[str, Any]]
) -> None:
    beats = written[0]["beats"]
    paragraphs = [f"{n}번째 문단이다. " + "가" * 280 + "." for n in range(1, 7)]
    write(conn, beats[0]["id"], 1, "\n\n".join(paragraphs))
    text = block(content(conn, beats[1]["id"]), "원문").removeprefix("바로 앞 원고:\n")
    # Whole paragraphs from the end, within the limit.
    assert text == "\n\n".join(paragraphs[-3:])
    assert len(text) <= write_context.PREVIOUS_CHARS


def test_tail_starts_at_a_paragraph_or_a_sentence() -> None:
    assert tail("짧다.", 10) == "짧다."
    assert tail("가나다.\n\n라마바사 아자차카", 12) == "라마바사 아자차카"
    assert tail('가나다. "라마바!" 사아자. 차카타파.', 14) == "사아자. 차카타파."
    assert tail("가나다라마바사아자차카타파하", 5) == "차카타파하"
    # A short last paragraph alone would lose the context: back to a sentence start.
    assert tail("가나다라. 마바사아자차카타.\n\n파하.", 16) == "마바사아자차카타.\n\n파하."


def test_summaries_and_state_are_given_when_there_are_any(
    conn: sqlite3.Connection, written: list[dict[str, Any]]
) -> None:
    beat = written[0]["beats"][0]
    text = content(
        conn,
        beat["id"],
        summaries=["1화 요약.", "2화 요약."],
        state=["테오: 북부 항구에 있다", "테오: 왼팔 부상"],
        target_chars=432,
    )
    assert block(text, "상태") == "테오: 북부 항구에 있다\n테오: 왼팔 부상"
    assert text.index("<참고 카드>") < text.index("<상태>") < text.index("<원문>")
    assert block(text, "원문") == (
        "지금까지의 줄거리:\n1화 요약.\n2화 요약.\n\n바로 앞 원고:\n(없음: 작품의 첫머리)"
    )
    # The adjusted target replaces the plan's.
    assert "분량: 공백 포함 432자 안팎" in text
    assert f"{beat['target_chars']}자" not in text


def test_the_oldest_summaries_are_dropped_first() -> None:
    assert newest_within(["가" * 900, "나" * 900, "다" * 900], 2000) == ["나" * 900, "다" * 900]
    assert newest_within(["가", "나"], 2000) == ["가", "나"]
    # One summary over the limit alone is still given.
    assert newest_within(["가" * 10, "나" * 3000], 2000) == ["나" * 3000]
    assert newest_within([], 2000) == []


def test_characters_the_beat_names_come_first_and_the_rest_while_they_fit(
    conn: sqlite3.Connection, written: list[dict[str, Any]]
) -> None:
    long = "길고 긴 말투 설명 " * 60
    for number in range(1, 4):
        add(
            conn,
            character(
                f"c_x{number}",
                f"단역{number}",
                speech={"description": long, "examples": ["가.", "나.", "다."]},
            ),
        )
    conn.executemany(
        "INSERT INTO episode_character (episode_id, card_id) VALUES ('c_ep1', ?)",
        [("c_x1",), ("c_x2",), ("c_x3",)],
    )
    beat = written[0]["beats"][0]
    conn.execute("UPDATE beat SET summary = '단역3과 미라가 만난다.' WHERE id = ?", (beat["id"],))
    cards = block(content(conn, beat["id"]), "참고 카드")
    names = [line.split(":")[0] for line in cards.splitlines() if line.startswith("인물 ")]
    # Named ones first, in the episode's order; then the others in order until the budget.
    assert names == ["인물 미라", "인물 단역3", "인물 테오"]


def test_world_cards_tied_to_the_episodes_cards_come_too(
    conn: sqlite3.Connection, written: list[dict[str, Any]]
) -> None:
    oath = fixture("world", id="c_oath", name="항구의 맹세")
    oath["data"] = {
        **oath["data"],
        "category": "culture",
        "summary": "항구 사람들이 지키는 침묵의 약속",
        "rules": [{"rule": "맹세를 깬 자는 배에 타지 못한다", "exception": None}],
        "terms": [],
        "related": ["c_mira"],
    }
    add(conn, oath)
    far = fixture("world", id="c_far", name="먼 나라의 법")
    far["data"] = {**far["data"], "summary": "이 에피소드와 무관하다", "related": []}
    add(conn, far)
    cards = block(content(conn, written[0]["beats"][0]["id"]), "참고 카드")
    worlds = [line for line in cards.splitlines() if line.startswith("세계관")]
    # The episode's own world card, then the one tied to a character of it.
    assert worlds == [
        "세계관(규칙·능력) 조수 마법: 바닷물을 매개로 하는 마법",
        "세계관(문화·용어) 항구의 맹세: 항구 사람들이 지키는 침묵의 약속",
    ]
    assert "  규칙: 맹세를 깬 자는 배에 타지 못한다" in cards
    assert "먼 나라의 법" not in cards


def test_world_cards_past_the_budget_keep_their_summary(
    conn: sqlite3.Connection, written: list[dict[str, Any]]
) -> None:
    big = fixture("world", id="c_big", name="긴 설정")
    big["data"] = {
        **big["data"],
        "summary": "아주 긴 설정",
        "rules": [{"rule": "규칙 " * 150, "exception": None}],
        "related": ["c_teo"],
    }
    add(conn, big)
    cards = block(content(conn, written[0]["beats"][0]["id"]), "참고 카드")
    assert "세계관(규칙·능력) 긴 설정: 아주 긴 설정" in cards
    assert "규칙 규칙" not in cards
    # The first world card keeps its rules.
    assert "  규칙: 바닷물이 닿는 곳에서만 쓸 수 있다" in cards


def test_an_unknown_beat_is_refused(conn: sqlite3.Connection) -> None:
    with pytest.raises(write_context.BeatNotFoundError):
        write_turns(conn, STYLE, "b_none")
