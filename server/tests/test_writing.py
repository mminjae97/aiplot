"""Writing beats (§10, §16, §19): the chapter job streams each beat by sentence, counts its
characters in code, writes a beat holding a banned phrase again, stores versions and goes on
from the last stored beat; a beat job writes one beat again."""

# Fixtures imported from other test modules (conn, client, llm, plan) are redefined as test
# parameters by name; that is how pytest passes them.
# ruff: noqa: F811

import asyncio
import sqlite3
import time
from typing import Any

import pytest
from fastapi.testclient import TestClient

from aiplot.jobs.queue import JobContext, JobQueue, JobRecord
from aiplot.llm.client import LlmError
from aiplot.llm.config import load_llm_config
from aiplot.llm.fake import FakeResponse, load_fixtures
from aiplot.services.write_context import count_chars
from aiplot.services.writing import (
    CONTINUATIONS,
    SentenceBuffer,
    complete,
    new_lines,
    next_target,
)
from tests.test_direction_roles import block, conn  # noqa: F401
from tests.test_draft_messages import Scripted
from tests.test_manuscript import chapters, confirmed, write
from tests.test_plan_direct_api import advance
from tests.test_plan_scenes_api import plan  # noqa: F401
from tests.test_plans_api import AUTH, client, error, llm, wait  # noqa: F401
from tests.test_stage_reopen import reopen

PROSE = load_fixtures()["write"].content
CLEAN = "테오는 배에서 내렸다. 안개가 짙었다."
BANNED = "그는 슬펐다. 테오는 배에서 내렸다."


@pytest.fixture
def written(
    client: TestClient, conn: sqlite3.Connection, plan: dict[str, Any]
) -> list[dict[str, Any]]:
    """The manuscript's chapters once writing started."""
    confirmed(client, conn, plan)
    assert advance(client).status_code == 200
    made: list[dict[str, Any]] = chapters(client)
    return made


def generate(client: TestClient, chapter_id: str) -> Any:
    return client.post(f"/api/v1/chapters/{chapter_id}/generate", headers=AUTH)


def regenerate(client: TestClient, beat_id: str) -> Any:
    return client.post(f"/api/v1/beats/{beat_id}/regenerate", headers=AUTH)


def finished(client: TestClient, response: Any) -> tuple[Any, list[tuple[str, dict[str, Any]]]]:
    """The finished job and its events as (type, data)."""
    assert response.status_code == 202, response.json()
    job_id = response.json()["jobId"]
    job = wait(client, job_id)
    record: JobRecord = client.app.state.jobs.get(job_id)  # type: ignore[attr-defined]
    return job, [(event.type, event.data) for event in record.events]


def versions(conn: sqlite3.Connection, beat_id: str) -> list[tuple[Any, ...]]:
    return [
        tuple(row)
        for row in conn.execute(
            "SELECT version, text, chars, origin, prompt_version, style_id, style_version "
            "FROM beat_version WHERE beat_id = ? ORDER BY version",
            (beat_id,),
        )
    ]


def asked(llm: Scripted, *, continued: bool = False) -> list[str]:
    """The user message of each write call that began a beat (or continued one), in order."""
    messages = [r.messages[1]["content"] for r in llm.requests if r.role == "write"]
    return [text for text in messages if ("이어 쓰기: " in block(text, "지시")) == continued]


def targets(llm: Scripted, *, continued: bool = False) -> list[int]:
    """The target each of those calls was given."""
    found = []
    for text in asked(llm, continued=continued):
        line = next(line for line in block(text, "지시").splitlines() if line.startswith("분량: "))
        found.append(int(line.removeprefix("분량: 공백 포함 ").removesuffix("자 안팎")))
    return found


def shown(events: list[tuple[str, dict[str, Any]]], beat_id: str) -> str:
    """The beat's text as the screen has it: its sentences since its last beat_start."""
    text = ""
    for kind, data in events:
        if data.get("beatId") == beat_id and kind == "beat_start":
            text = ""
        elif data.get("beatId") == beat_id and kind == "sentence":
            text += data["text"]
    return text


def prose(chars: int) -> str:
    """Distinct sentences, one per line, of at least this many chars together."""
    lines: list[str] = []
    while count_chars("".join(lines)) < chars:
        lines.append(f"{len(lines) + 1}번째 파도가 말뚝을 때리고 물러갔다.")
    return "\n".join(lines)


# pieces ----------------------------------------------------------------------------------------


def test_text_is_given_back_by_sentence() -> None:
    buffer = SentenceBuffer()
    text = '안개가 짙었다.\n\n"늦었네."\n\n테오는 돌아보지 않았다... 정말? 3.5초쯤.'
    pieces = [piece for at in range(0, len(text), 3) for piece in buffer.feed(text[at : at + 3])]
    rest = buffer.flush()
    assert pieces == [
        "안개가 짙었다.\n\n",
        '"늦었네."\n\n',
        "테오는 돌아보지 않았다... ",
        "정말? ",
        "3.",
    ]
    assert rest == "5초쯤."
    assert "".join(pieces) + rest == text
    assert buffer.flush() == ""


def test_chars_count_spaces_but_not_line_breaks() -> None:
    assert count_chars("가 나\n\n다.\r\n") == 5
    assert count_chars("") == 0


def test_the_next_target_follows_what_the_chapter_has_left() -> None:
    # On plan: the next beat keeps its target.
    assert next_target(3000, 1000, [800, 1200]) == 800
    # Short so far: more is asked of the next beat, up to half as much again.
    assert next_target(3000, 700, [800, 1200]) == 920
    assert next_target(3000, 0, [800]) == 1200
    # Long so far: less, down to half.
    assert next_target(3000, 1500, [800, 1200]) == 600
    assert next_target(3000, 2900, [800, 1200]) == 400
    assert next_target(3000, 3500, [800, 1200]) == 400


def test_a_cut_text_ends_at_its_last_whole_sentence() -> None:
    assert complete("  가나다. 라마바  ", "stop") == "가나다. 라마바"
    assert complete("가나다.  \n라마바. \t\n\n사아자.  ", "stop") == "가나다.\n라마바.\n\n사아자."
    assert complete('가나다. "라마바." 사아', "length") == '가나다. "라마바."'
    assert complete("가나다\n라마", "length") == "가나다\n라마"


def test_lines_the_beat_already_has_are_dropped_from_what_is_added() -> None:
    text = '테오는 배에서 내렸다.\n\n"네."\n\n안개가 부두를 덮고 있었다.'
    more = '안개가 부두를 덮고 있었다.\n\n"네."\n\n테오는 배에서 내렸다.\n\n\n미라가 다가왔다.'
    # The breaks left by dropped lines close up.
    assert new_lines(more, text) == "미라가 다가왔다."
    assert new_lines(text, text) == ""
    assert new_lines("새 줄이 하나 붙었다.", text) == "새 줄이 하나 붙었다."


# the chapter job -------------------------------------------------------------------------------


def test_a_chapter_is_written_beat_by_beat(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    chapter = written[0]
    beats = chapter["beats"]
    job, events = finished(client, generate(client, chapter["id"]))
    assert (job["status"], job["kind"], job["key"]) == (
        "done",
        "chapter",
        f"chapter:{chapter['id']}",
    )
    # §16: per beat progress, beat_start, sentences, beat_done, then its check; then done.
    kinds = [kind for kind, _ in events]
    # The fixture is short of every target and says the same again: each beat is continued
    # once, nothing is added, and the beat's text is shown again as it is kept. Its check
    # finds the same change every time: only the first beat's is new.
    written_beat = ["progress", "beat_start", "sentence", "beat_start", "sentence", "beat_done"]
    first = [*written_beat, "state_update", "beat_checked"]
    later = [*written_beat, "beat_checked"]
    collapsed = [kind for at, kind in enumerate(kinds) if at == 0 or kind != kinds[at - 1]]
    assert collapsed == first + later * (len(beats) - 1) + ["progress", "done"]
    assert [data["beatId"] for kind, data in events if kind == "beat_done"] == [
        beat["id"] for beat in beats
    ]
    progress = [(data["done"], data["total"]) for kind, data in events if kind == "progress"]
    assert progress == [(done, len(beats)) for done in range(len(beats) + 1)]
    # A beat's sentences joined are the text as it arrived.
    assert shown(events, beats[0]["id"]) == PROSE
    assert len([1 for kind, _ in events if kind == "sentence"]) > len(beats)
    # Stored with what made it; chars counted in code, line breaks left out.
    chars = count_chars(PROSE)
    config = load_llm_config().roles["write"]
    assert config.style is not None
    for beat in beats:
        assert versions(conn, beat["id"]) == [
            (1, PROSE, chars, "generated", config.prompt, config.style.id, config.style.version)
        ]
    done = events[-1][1]["result"]
    assert (done["chars"], done["warnings"]) == (chars * len(beats), 0)
    assert done["elapsedSec"] >= 0
    listed = chapters(client)[0]
    assert listed["chars"] == chars * len(beats)
    assert all((b["version"], b["chars"]) == (1, chars) for b in listed["beats"])
    # The fixture runs short of every target, so each next beat is asked for more.
    asked_for = targets(llm)
    assert asked_for[0] == beats[0]["target_chars"]
    assert all(
        given > beat["target_chars"] for given, beat in zip(asked_for[1:], beats[1:], strict=True)
    )
    assert all(
        given <= round(beat["target_chars"] * 1.5)
        for given, beat in zip(asked_for, beats, strict=True)
    )
    # The second beat goes on from the first one's text.
    assert block(asked(llm)[1], "원문").endswith(PROSE[-40:])
    # Each continuation was asked for what its beat still missed, from the beat's own end.
    assert targets(llm, continued=True) == [given - chars for given in asked_for]
    assert all(block(text, "원문").endswith(PROSE[-40:]) for text in asked(llm, continued=True))


def test_a_written_chapter_has_nothing_to_generate(
    client: TestClient, written: list[dict[str, Any]]
) -> None:
    finished(client, generate(client, written[0]["id"]))
    assert error(generate(client, written[0]["id"])) == (409, "CHAPTER_WRITTEN")
    assert error(generate(client, "ch_none")) == (404, "CHAPTER_NOT_FOUND")
    assert generate(client, written[1]["id"]).status_code == 202
    assert client.post(f"/api/v1/chapters/{written[0]['id']}/generate").status_code == 401


def test_a_stopped_chapter_goes_on_from_the_last_stored_beat(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    beats = written[0]["beats"]
    write(conn, beats[0]["id"], 1, "이미 쓴 첫 비트.")
    write(conn, beats[2]["id"], 1, "이미 쓴 셋째 비트.")
    job, events = finished(client, generate(client, written[0]["id"]))
    assert job["status"] == "done"
    todo = [beat["id"] for at, beat in enumerate(beats) if at not in (0, 2)]
    assert [data["beatId"] for kind, data in events if kind == "beat_done"] == todo
    assert versions(conn, beats[0]["id"])[0][1] == "이미 쓴 첫 비트."
    assert len(versions(conn, beats[0]["id"])) == 1
    assert events[0] == (
        "progress",
        {"done": 2, "total": len(beats), "etaSec": None, "step": "write"},
    )


def test_the_same_chapter_has_one_job_at_a_time(
    client: TestClient, written: list[dict[str, Any]]
) -> None:
    jobs: JobQueue = client.app.state.jobs  # type: ignore[attr-defined]

    async def waits(ctx: JobContext) -> None:
        await asyncio.sleep(30)

    portal = client.portal
    assert portal is not None  # the client runs the app's loop
    # The model is busy: the chapter's job waits in the queue.
    busy = portal.call(lambda: jobs.submit("card", waits, work_id="w_01"))
    first = generate(client, written[0]["id"])
    again = generate(client, written[0]["id"])
    other = generate(client, written[1]["id"])
    assert first.json()["jobId"] == again.json()["jobId"] != other.json()["jobId"]
    portal.call(jobs.cancel, busy)
    assert wait(client, first.json()["jobId"])["status"] == "done"
    assert wait(client, other.json()["jobId"])["status"] == "done"


# banned phrases and bad output -------------------------------------------------------------------


def test_a_beat_with_a_banned_phrase_is_written_again(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    beat = written[0]["beats"][0]
    llm.say("write", BANNED, BANNED, CLEAN)
    job, events = finished(client, regenerate(client, beat["id"]))
    assert job["status"] == "done"
    # Each generation starts the beat's text over on the screen.
    # (The fourth: the clean text shown again after a continuation that added nothing.)
    assert [kind for kind, _ in events if kind in ("beat_start", "beat_done")] == [
        "beat_start",
        "beat_start",
        "beat_start",
        "beat_start",
        "beat_done",
    ]
    assert [row[1] for row in versions(conn, beat["id"])] == [CLEAN]
    assert shown(events, beat["id"]) == CLEAN
    assert events[-1][1]["result"]["warnings"] == 0


def test_after_three_more_tries_the_last_text_is_kept(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    beat = written[0]["beats"][0]
    llm.say("write", BANNED)
    job, events = finished(client, regenerate(client, beat["id"]))
    assert job["status"] == "done"
    assert len([1 for kind, _ in events if kind == "beat_start"]) == 4
    assert [row[1] for row in versions(conn, beat["id"])] == [BANNED]
    assert events[-1][1]["result"]["warnings"] == 1


def test_an_empty_beat_fails_the_job(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    beat = written[0]["beats"][0]
    llm.say("write", "  \n ")
    job, _ = finished(client, regenerate(client, beat["id"]))
    assert (job["status"], job["error"]["code"]) == ("failed", "LLM_INVALID_OUTPUT")
    assert versions(conn, beat["id"]) == []
    # An empty try followed by a text is fine.
    llm.say("write", "", CLEAN)
    job, _ = finished(client, regenerate(client, beat["id"]))
    assert job["status"] == "done"
    assert [row[1] for row in versions(conn, beat["id"])] == [CLEAN]


def test_a_text_cut_at_max_tokens_is_stored_up_to_its_last_sentence(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    beat = written[0]["beats"][0]
    llm.script["write"] = [FakeResponse(content="테오는 내렸다. 안개가 짙", finish_reason="length")]
    job, _ = finished(client, regenerate(client, beat["id"]))
    assert job["status"] == "done"
    assert versions(conn, beat["id"])[0][1:3] == ("테오는 내렸다.", 8)


def test_a_model_failure_fails_the_job_and_keeps_what_was_stored(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    beats = written[0]["beats"]
    calls = []

    def fail_on_the_third_beat() -> None:
        """Each beat before it took two calls: the beat, and a continuation adding nothing."""
        calls.append(1)
        if len(calls) == 5:
            llm.failures["write"] = LlmError("LLM_UNAVAILABLE", "the model is not running")

    llm.hooks["write"] = fail_on_the_third_beat
    job, _ = finished(client, generate(client, written[0]["id"]))
    assert (job["status"], job["error"]["code"]) == ("failed", "LLM_UNAVAILABLE")
    assert [len(versions(conn, beat["id"])) for beat in beats[:3]] == [1, 1, 0]
    assert len(calls) == 5
    # 이어서 생성: the rest is written by the next job.
    del llm.failures["write"], llm.hooks["write"]
    job, events = finished(client, generate(client, written[0]["id"]))
    assert job["status"] == "done"
    assert len([1 for kind, _ in events if kind == "beat_done"]) == len(beats) - 2


# pause and cancel --------------------------------------------------------------------------------


def test_a_pause_lands_between_beats(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    jobs: JobQueue = client.app.state.jobs  # type: ignore[attr-defined]
    beats = written[0]["beats"]

    # Asked for while the first beat is being written.
    def pause_once() -> None:
        del llm.hooks["write"]
        assert jobs.pause(jobs.for_work("w_01")[0])

    llm.hooks["write"] = pause_once
    job_id = generate(client, written[0]["id"]).json()["jobId"]
    record = jobs.get(job_id)
    assert record is not None
    deadline = time.monotonic() + 2
    while record.status != "paused" and time.monotonic() < deadline:
        time.sleep(0.01)
    assert record.status == "paused"
    # The beat it was writing is whole and stored; the next one has not begun.
    kinds = [event.type for event in record.events]
    # (Two beat_starts: the beat, and its text shown again after the continuation.)
    assert kinds[-4:] == ["beat_done", "state_update", "beat_checked", "paused"]
    assert kinds.count("beat_done") == 1
    assert kinds.count("beat_start") == 2
    assert [len(versions(conn, beat["id"])) for beat in beats[:2]] == [1, 0]
    assert client.post(f"/api/v1/jobs/{job_id}/resume", headers=AUTH).status_code == 200
    assert wait(client, job_id)["status"] == "done"
    assert all(len(versions(conn, beat["id"])) == 1 for beat in beats)


def test_a_cancelled_job_does_not_store_the_beat_it_was_writing(
    client: TestClient,
    conn: sqlite3.Connection,
    written: list[dict[str, Any]],
    llm: Scripted,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    jobs: JobQueue = client.app.state.jobs  # type: ignore[attr-defined]
    beats = written[0]["beats"]
    fixture = llm.stream
    calls = []

    async def cancelled_in_the_second_beat(request: Any) -> Any:
        """The fixture's deltas, giving the loop a turn after each (as a real stream does);
        the job is cancelled once the second beat's first words are out (the third write call:
        the first beat was continued once)."""
        calls.extend([1] if request.role == "write" else [])
        sent = 0
        async for delta in fixture(request):
            yield delta
            sent += 1
            if request.role == "write" and len(calls) == 3 and sent == 2:
                assert jobs.cancel(jobs.for_work("w_01")[0])
            await asyncio.sleep(0)

    monkeypatch.setattr(llm, "stream", cancelled_in_the_second_beat)
    job, events = finished(client, generate(client, written[0]["id"]))
    assert job["status"] == "cancelled"
    assert [kind for kind, _ in events if kind in ("beat_start", "beat_done")] == [
        "beat_start",
        "beat_start",
        "beat_done",
        "beat_start",
    ]
    assert events[-1][0] == "cancelled"
    assert [len(versions(conn, beat["id"])) for beat in beats[:2]] == [1, 0]
    # 이어서 생성: the next job starts with the beat that was dropped.
    monkeypatch.undo()
    job, events = finished(client, generate(client, written[0]["id"]))
    assert job["status"] == "done"
    assert [data["beatId"] for kind, data in events if kind == "beat_done"] == [
        beat["id"] for beat in beats[1:]
    ]


# continuing a short beat -------------------------------------------------------------------------


def test_a_beat_that_came_short_is_continued(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    beat = written[0]["beats"][0]
    target = beat["target_chars"]
    more = prose(target)
    llm.say("write", CLEAN, more)
    job, events = finished(client, regenerate(client, beat["id"]))
    assert job["status"] == "done"
    # One version: the beat, then what the second call added, as a new paragraph.
    text = f"{CLEAN}\n\n{more}"
    assert [row[1:3] for row in versions(conn, beat["id"])] == [(text, count_chars(text))]
    # The screen went on from what it had: no second beat_start.
    assert [kind for kind, _ in events if kind == "beat_start"] == ["beat_start"]
    assert shown(events, beat["id"]) == text
    [again] = asked(llm, continued=True)
    assert f"이어 쓰기: 이 비트는 이미 {count_chars(CLEAN)}자를 썼다." in block(again, "지시")
    assert targets(llm, continued=True) == [target - count_chars(CLEAN)]
    assert block(again, "원문").endswith(CLEAN)
    assert events[-1][1]["result"]["chars"] == count_chars(text)


def test_a_beat_is_continued_only_so_many_times(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    beat = written[0]["beats"][0]
    parts = [f"{n}번째로 쓴 짧은 대목이다." for n in range(1, CONTINUATIONS + 4)]
    llm.say("write", *parts)
    job, events = finished(client, regenerate(client, beat["id"]))
    assert job["status"] == "done"
    kept = "\n\n".join(parts[: 1 + CONTINUATIONS])
    assert [row[1] for row in versions(conn, beat["id"])] == [kept]
    assert shown(events, beat["id"]) == kept
    # Each call was asked for what was still missing by then.
    missing = [
        beat["target_chars"] - count_chars("\n\n".join(parts[:at]))
        for at in range(1, 1 + CONTINUATIONS)
    ]
    assert targets(llm, continued=True) == missing


def test_a_continuation_keeps_only_its_new_lines(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    beat = written[0]["beats"][0]
    # The second call starts the beat over before it goes on; the third only repeats.
    llm.say("write", CLEAN, f"{CLEAN}\n\n미라가 봉투를 내밀었다.", CLEAN)
    job, events = finished(client, regenerate(client, beat["id"]))
    assert job["status"] == "done"
    kept = f"{CLEAN}\n\n미라가 봉투를 내밀었다."
    assert [row[1] for row in versions(conn, beat["id"])] == [kept]
    # The screen had the copied line: the beat is shown again as it is kept, both times.
    assert len([1 for kind, _ in events if kind == "beat_start"]) == 3
    assert shown(events, beat["id"]) == kept
    assert len(asked(llm, continued=True)) == 2


def test_a_continuation_with_a_banned_phrase_or_cut_short_is_not_kept(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    beat = written[0]["beats"][0]
    llm.say("write", CLEAN, "미라가 다가왔다. 그는 슬펐다.", "다시는 불리지 않는다.")
    job, events = finished(client, regenerate(client, beat["id"]))
    assert job["status"] == "done"
    assert [row[1] for row in versions(conn, beat["id"])] == [CLEAN]
    assert shown(events, beat["id"]) == CLEAN
    assert events[-1][1]["result"]["warnings"] == 0
    assert len(asked(llm, continued=True)) == 1
    # A continuation that ran to max_tokens looped: none of it is kept.
    llm.script["write"] = [
        FakeResponse(content=CLEAN),
        FakeResponse(content="미라가 다가왔다. 미라가 다가", finish_reason="length"),
    ]
    job, events = finished(client, regenerate(client, beat["id"]))
    assert job["status"] == "done"
    assert versions(conn, beat["id"])[-1][1] == CLEAN
    assert shown(events, beat["id"]) == CLEAN
    # Neither is a text kept with a banned phrase or one cut at max_tokens continued.
    llm.requests.clear()
    llm.say("write", BANNED)
    finished(client, regenerate(client, beat["id"]))
    llm.script["write"] = [FakeResponse(content="테오는 내렸다. 안개가 짙", finish_reason="length")]
    finished(client, regenerate(client, beat["id"]))
    assert asked(llm, continued=True) == []


# one beat again ----------------------------------------------------------------------------------


def test_a_beat_is_written_again_as_a_new_version(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    beat = written[0]["beats"][1]
    write(conn, beat["id"], 1, "옛 글.")
    llm.say("write", CLEAN)
    job, events = finished(client, regenerate(client, beat["id"]))
    assert (job["status"], job["kind"], job["key"]) == ("done", "beat", f"beat:{beat['id']}")
    kinds = [kind for kind, _ in events]
    assert [kind for at, kind in enumerate(kinds) if at == 0 or kind != kinds[at - 1]] == [
        "progress",
        "beat_start",
        "sentence",
        "beat_start",
        "sentence",
        "beat_done",
        "state_update",
        "beat_checked",
        "progress",
        "done",
    ]
    done = next(data for kind, data in events if kind == "beat_done")
    assert done == {"beatId": beat["id"], "chars": count_chars(CLEAN), "version": 2}
    assert [row[:2] for row in versions(conn, beat["id"])] == [(1, "옛 글."), (2, CLEAN)]
    # At its plan target, whatever the chapter has left.
    assert targets(llm) == [beat["target_chars"]]
    assert events[-1][1]["result"]["chars"] == count_chars(CLEAN)
    assert error(regenerate(client, "b_none")) == (404, "BEAT_NOT_FOUND")


# reopening ---------------------------------------------------------------------------------------


def test_a_reopen_cancels_the_works_writing_jobs(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]]
) -> None:
    jobs: JobQueue = client.app.state.jobs  # type: ignore[attr-defined]

    async def waits(ctx: JobContext) -> None:
        await asyncio.sleep(30)

    def submit(kind: str) -> JobRecord:
        return jobs.submit(kind, waits, work_id="w_01")

    portal = client.portal
    assert portal is not None  # the client runs the app's loop
    chapter = portal.call(submit, "chapter")
    beat = portal.call(submit, "beat")
    assert reopen(client, 2).status_code == 200
    deadline = time.monotonic() + 2
    while beat.status != "cancelled" and time.monotonic() < deadline:
        time.sleep(0.01)
    assert (chapter.status, beat.status) == ("cancelled", "cancelled")
    # Direction is open again: the chapters are gone and nothing can be written.
    assert error(generate(client, written[0]["id"])) == (404, "CHAPTER_NOT_FOUND")


def test_a_beat_written_after_a_reopen_is_not_stored(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    beat = written[0]["beats"][0]

    # The stage goes back while the role writes (as if the cancel had not landed yet).
    def back_to_direction() -> None:
        conn.execute("UPDATE work SET stage = 2, locked_stage = 1 WHERE id = 'w_01'")

    llm.hooks["write"] = back_to_direction
    job, _ = finished(client, regenerate(client, beat["id"]))
    assert (job["status"], job["error"]["code"]) == ("failed", "STAGE_NOT_STARTED")
    assert versions(conn, beat["id"]) == []
