"""Summaries of the manuscript (§10): made again after every stored beat, and given to the write
role as the story so far."""

# Fixtures imported from other test modules (conn, client, llm, plan, written) are redefined as
# test parameters by name; that is how pytest passes them.
# ruff: noqa: F811

import sqlite3
from typing import Any

from fastapi.testclient import TestClient

from aiplot.llm.fake import FakeResponse
from aiplot.services.summaries import story_so_far
from tests.test_direction_roles import block, conn  # noqa: F401
from tests.test_draft_messages import Scripted
from tests.test_manuscript import write
from tests.test_plan_scenes_api import plan  # noqa: F401
from tests.test_plans_api import client, llm  # noqa: F401
from tests.test_stage_reopen import reopen
from tests.test_writing import (  # noqa: F401
    PROSE,
    asked,
    finished,
    generate,
    regenerate,
    versions,
    written,
)

SAID = (
    "테오는 안개 낀 부두에 배를 대고 미라를 만났다. 미라는 삼 년 전에 테오 앞으로 온 봉투를 건넸다."
)


def summary(call: int) -> str:
    """The fixture's answer to the summary role's call-th call."""
    return f"요약 {call}: {SAID}"


def summary_calls(llm: Scripted) -> list[tuple[str, str]]:
    """Each summary call as (what was to be summarized, the order's lines)."""
    messages = [r.messages[1]["content"] for r in llm.requests if r.role == "summary"]
    return [(block(text, "원문"), block(text, "지시")) for text in messages]


def stored(conn: sqlite3.Connection, chapter_id: str) -> tuple[Any, ...]:
    return tuple(
        conn.execute(
            "SELECT progress_summary, summary_long, summary_short FROM chapter WHERE id = ?",
            (chapter_id,),
        ).fetchone()
    )


def episode_summary(conn: sqlite3.Connection, episode_id: str) -> Any:
    return conn.execute("SELECT summary FROM episode WHERE card_id = ?", (episode_id,)).fetchone()[
        0
    ]


def test_a_chapter_is_summarized_after_each_beat(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    chapter = written[0]
    beats = chapter["beats"]
    job, _ = finished(client, generate(client, chapter["id"]))
    assert job["status"] == "done"
    calls = summary_calls(llm)
    # Its progress after every beat but the last, then the whole chapter long and short.
    kinds = [order.splitlines()[0] for _, order in calls]
    assert kinds == ["종류: 쓰고 있는 화의 지금까지"] * (len(beats) - 1) + [
        "종류: 다 쓴 화 (긴 요약)",
        "종류: 다 쓴 화 (짧은 요약)",
    ]
    assert [order.splitlines()[1] for _, order in calls[-3:]] == [
        "분량: 공백 포함 400자 안팎",
        "분량: 공백 포함 1000자 안팎",
        "분량: 공백 포함 200자 안팎",
    ]
    # From the chapter's text so far, beats a blank line apart.
    assert [text for text, _ in calls[:2]] == [PROSE, f"{PROSE}\n\n{PROSE}"]
    assert calls[-1][0] == "\n\n".join([PROSE] * len(beats))
    # The end summaries replace the progress; the episode has a chapter still to write.
    count = len(beats)
    assert stored(conn, chapter["id"]) == (None, summary(count), summary(count + 1))
    assert episode_summary(conn, "c_ep1") is None
    # Each beat after the first was told the chapter so far.
    told = [block(text, "원문") for text in asked(llm)]
    assert "지금까지의 줄거리" not in told[0]
    for at in range(1, len(beats)):
        assert told[at].startswith(f"지금까지의 줄거리:\n이번 화 지금까지: {summary(at)}\n\n")
    # So was each continuation.
    assert all("이번 화 지금까지: " in block(t, "원문") for t in asked(llm, continued=True)[1:])


def test_an_episode_is_summarized_when_its_last_chapter_is_written(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    first, second, third = written[0], written[1], written[2]
    finished(client, generate(client, first["id"]))
    _, long, _ = stored(conn, first["id"])
    llm.requests.clear()
    finished(client, generate(client, second["id"]))
    # The chapter just before in full; nothing yet of this one.
    opening = block(asked(llm)[0], "원문")
    assert opening.startswith(f"지금까지의 줄거리:\n1화 (바로 앞 화): {long}\n\n앞 화의 끝")
    # The episode's summary from its chapters' long ones.
    _, long_2, short_2 = stored(conn, second["id"])
    text, order = summary_calls(llm)[-1]
    assert text == f"1화: {long}\n\n2화: {long_2}"
    assert order == "종류: 에피소드 전체 (화 요약들을 하나로)\n분량: 공백 포함 300자 안팎"
    told = episode_summary(conn, "c_ep1")
    assert told is not None and told.endswith(SAID)
    # The next episode's first chapter: the episode before as one, its last chapter in full.
    name = conn.execute("SELECT name FROM card WHERE id = 'c_ep1'").fetchone()[0]
    assert story_so_far(conn, third["id"]) == [
        f"앞선 에피소드 {name}: {told}",
        f"2화 (바로 앞 화): {long_2}",
    ]
    # Within an episode: earlier chapters short, the one before long, then its own progress.
    write(conn, third["beats"][0]["id"], 1, "셋째 화의 첫 비트.")
    conn.execute(
        "UPDATE chapter SET summary_long = '3화 긴 요약.', summary_short = '3화 짧은 요약.' "
        "WHERE id = ?",
        (third["id"],),
    )
    conn.execute(
        "UPDATE chapter SET progress_summary = '4화 진행.' WHERE id = ?", (written[3]["id"],)
    )
    assert story_so_far(conn, written[3]["id"]) == [
        f"앞선 에피소드 {name}: {told}",
        "3화 (바로 앞 화): 3화 긴 요약.",
        "이번 화 지금까지: 4화 진행.",
    ]
    # An episode without a summary yet is told by its chapters' short ones.
    conn.execute("UPDATE episode SET summary = NULL WHERE card_id = 'c_ep1'")
    assert story_so_far(conn, written[3]["id"])[:2] == [
        f"1화: {stored(conn, first['id'])[2]}",
        f"2화: {short_2}",
    ]


def test_a_beat_written_again_has_its_chapter_summarized_again(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    for chapter in written[:2]:
        finished(client, generate(client, chapter["id"]))
    before = stored(conn, written[0]["id"])
    was = episode_summary(conn, "c_ep1")
    llm.requests.clear()
    beat = written[0]["beats"][1]
    job, _ = finished(client, regenerate(client, beat["id"]))
    assert job["status"] == "done"
    # The whole chapter again, and its episode.
    assert [order.splitlines()[0] for _, order in summary_calls(llm)] == [
        "종류: 다 쓴 화 (긴 요약)",
        "종류: 다 쓴 화 (짧은 요약)",
        "종류: 에피소드 전체 (화 요약들을 하나로)",
    ]
    after = stored(conn, written[0]["id"])
    assert after[0] is None and after[1] != before[1] and after[2] != before[2]
    assert episode_summary(conn, "c_ep1") != was
    # A chapter with a beat still to write: its progress, and its episode is not whole.
    third = written[2]
    write(conn, third["beats"][0]["id"], 1, "셋째 화의 첫 비트.")
    conn.execute("UPDATE episode SET summary = '옛 요약.' WHERE card_id = 'c_ep0'")
    finished(client, regenerate(client, third["beats"][0]["id"]))
    progress, long, short = stored(conn, third["id"])
    assert progress is not None and (long, short) == (None, None)
    assert episode_summary(conn, "c_ep0") is None


def test_a_summary_is_one_paragraph_and_ends_on_a_whole_sentence(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    chapter = written[0]
    beat = chapter["beats"][0]
    llm.script["summary"] = [
        FakeResponse(
            content="  테오는 내렸다.\n\n미라가 봉투를  건넸다. 봉투에는", finish_reason="length"
        )
    ]
    finished(client, regenerate(client, beat["id"]))
    assert stored(conn, chapter["id"])[0] == "테오는 내렸다. 미라가 봉투를 건넸다."


def test_an_empty_summary_is_asked_for_once_more(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    chapter = written[0]
    beat = chapter["beats"][0]
    llm.say("summary", " \n", "테오는 내렸다.")
    job, _ = finished(client, regenerate(client, beat["id"]))
    assert job["status"] == "done"
    assert stored(conn, chapter["id"])[0] == "테오는 내렸다."
    # Empty twice: the job fails, the beat it wrote stays.
    llm.say("summary", "")
    job, _ = finished(client, regenerate(client, beat["id"]))
    assert (job["status"], job["error"]["code"]) == ("failed", "LLM_INVALID_OUTPUT")
    assert len(versions(conn, beat["id"])) == 2


def test_a_reopen_drops_the_episodes_summaries(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]]
) -> None:
    for chapter in written[:2]:
        finished(client, generate(client, chapter["id"]))
    assert episode_summary(conn, "c_ep1") is not None
    title = conn.execute("SELECT title FROM work WHERE id = 'w_01'").fetchone()[0]
    assert reopen(client, 2, title=title).status_code == 200
    assert episode_summary(conn, "c_ep1") is None
