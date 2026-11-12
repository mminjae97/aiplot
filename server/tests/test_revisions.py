"""The user's changes to the manuscript (§10, §16): a beat's text saved or put back to an earlier
version becomes its next version, and a job checks it again and redoes the chapter's summaries;
the chapter's manuscript is read in one call."""

# Fixtures imported from other test modules (conn, client, llm, plan, written) are redefined as
# test parameters by name; that is how pytest passes them.
# ruff: noqa: F811

import sqlite3
import time
from typing import Any

from fastapi.testclient import TestClient

from aiplot.jobs.queue import JobQueue, JobRecord
from aiplot.services import revisions
from aiplot.services.write_context import count_chars
from tests.test_checks import ENVELOPE, ENVELOPE_VALUE, HAIR, output, state_rows, warnings_of
from tests.test_direction_roles import conn  # noqa: F401
from tests.test_draft_messages import Scripted
from tests.test_manuscript import write
from tests.test_plan_scenes_api import plan  # noqa: F401
from tests.test_plans_api import AUTH, client, error, llm, wait  # noqa: F401
from tests.test_stage_reopen import reopen
from tests.test_writing import CLEAN, generate, versions, written  # noqa: F401

EDITED = "테오는 배에서 내리지 않았다.\n\n안개가 걷혔다."


def text_of(client: TestClient, chapter_id: str) -> Any:
    response = client.get(f"/api/v1/chapters/{chapter_id}", headers=AUTH)
    assert response.status_code == 200, response.json()
    return response.json()


def put(client: TestClient, beat_id: str, text: str) -> Any:
    return client.put(f"/api/v1/beats/{beat_id}/text", headers=AUTH, json={"text": text})


def restore(client: TestClient, beat_id: str, version: int) -> Any:
    return client.post(f"/api/v1/beats/{beat_id}/versions/{version}/restore", headers=AUTH)


def listed(client: TestClient, beat_id: str) -> list[dict[str, Any]]:
    response = client.get(f"/api/v1/beats/{beat_id}/versions", headers=AUTH)
    assert response.status_code == 200, response.json()
    found: list[dict[str, Any]] = response.json()["versions"]
    return found


def events_of(client: TestClient, job_id: str) -> list[tuple[str, dict[str, Any]]]:
    record: JobRecord = client.app.state.jobs.get(job_id)  # type: ignore[attr-defined]
    return [(event.type, event.data) for event in record.events]


def summaries_asked(llm: Scripted) -> int:
    return len([1 for request in llm.requests if request.role == "summary"])


def test_a_chapters_manuscript_is_read_in_one_call(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]]
) -> None:
    chapter = written[0]
    beats = chapter["beats"]
    write(conn, beats[0]["id"], 1, "옛 글.")
    write(conn, beats[0]["id"], 2, CLEAN)
    found = text_of(client, chapter["id"])
    assert (found["id"], found["number"]) == (chapter["id"], 1)
    assert [beat["id"] for beat in found["beats"]] == [beat["id"] for beat in beats]
    assert found["beats"][0] == {
        "id": beats[0]["id"],
        "order": 1,
        "version": 2,
        "chars": len(CLEAN),
        "origin": "generated",
        "text": CLEAN,
    }
    unwritten = {"version": None, "chars": None, "origin": None, "text": None}
    assert all({**beat, **unwritten} == beat for beat in found["beats"][1:])
    missing = client.get("/api/v1/chapters/ch_none", headers=AUTH)
    assert error(missing) == (404, "CHAPTER_NOT_FOUND")


def test_a_saved_text_is_a_new_version_checked_again(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    chapter = written[0]
    beat = chapter["beats"][0]["id"]
    write(conn, beat, 1, CLEAN)
    conn.execute(
        "INSERT INTO state_record (beat_id, card_id, key, value) "
        "VALUES (?, 'c_mira', 'appearance_change', '{\"text\": \"옛 글의 상태\"}')",
        (beat,),
    )
    llm.say("check", output([ENVELOPE], [HAIR]))
    before = summaries_asked(llm)
    # Stored as generated texts are: trimmed, no spaces at a line's end.
    saved = put(client, beat, f"  {EDITED.replace(chr(10) * 2, '  ' + chr(10) * 2)} \n")
    assert saved.status_code == 200, saved.json()
    body = saved.json()
    assert body["version"] == {
        "version": 2,
        "text": EDITED,
        "chars": count_chars(EDITED),
        "origin": "edited",
        "created_at": body["version"]["created_at"],
    }
    job = wait(client, body["jobId"])
    assert (job["status"], job["kind"], job["key"]) == ("done", "recheck", f"recheck:{beat}:2")
    # No prompt or style made it: the user did.
    assert versions(conn, beat)[1] == (2, EDITED, count_chars(EDITED), "edited", None, None, None)
    assert [(v["version"], v["origin"]) for v in listed(client, beat)] == [
        (1, "generated"),
        (2, "edited"),
    ]
    assert text_of(client, chapter["id"])["beats"][0]["text"] == EDITED
    # The check read the new text: its state replaces the old text's, its warning is on v2.
    events = events_of(client, body["jobId"])
    kinds = [kind for kind, _ in events if kind != "progress"]
    assert kinds == ["state_update", "warning", "beat_checked", "done"]
    assert state_rows(conn) == [(beat, "c_teo", "item", ENVELOPE_VALUE)]
    [warning] = warnings_of(client, chapter["id"])
    assert (warning["version"], warning["kind"]) == (2, "appearance")
    assert events[-1][1]["result"]["warnings"] == 1
    # The chapter's summary was made again from the new text.
    assert summaries_asked(llm) == before + 1
    asked = [r.messages[1]["content"] for r in llm.requests if r.role == "summary"][-1]
    assert "테오는 배에서 내리지 않았다." in asked
    # The same text again stores nothing and starts nothing.
    again = put(client, beat, EDITED + "\n")
    assert again.json() == {"version": body["version"], "jobId": None}
    assert len(listed(client, beat)) == 2


def test_a_text_that_may_not_be_saved(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    chapter = written[0]
    beats = chapter["beats"]
    assert error(put(client, beats[0]["id"], " \n ")) == (422, "TEXT_EMPTY")
    assert error(put(client, "b_none", CLEAN)) == (404, "BEAT_NOT_FOUND")
    assert error(client.get("/api/v1/beats/b_none/versions", headers=AUTH)) == (
        404,
        "BEAT_NOT_FOUND",
    )
    assert listed(client, beats[0]["id"]) == []
    # While a job writes the chapter (here: paused in it) its beats may not change under it.
    jobs: JobQueue = client.app.state.jobs  # type: ignore[attr-defined]

    def pause_once() -> None:
        del llm.hooks["write"]
        assert jobs.pause(jobs.for_work("w_01")[0])

    llm.hooks["write"] = pause_once
    job_id = generate(client, chapter["id"]).json()["jobId"]
    record = jobs.get(job_id)
    assert record is not None
    deadline = time.monotonic() + 2
    while record.status != "paused" and time.monotonic() < deadline:
        time.sleep(0.01)
    assert record.status == "paused"
    assert error(put(client, beats[0]["id"], EDITED)) == (409, "BEAT_BUSY")
    assert error(restore(client, beats[0]["id"], 1)) == (409, "BEAT_BUSY")
    assert client.post(f"/api/v1/jobs/{job_id}/cancel", headers=AUTH).status_code == 200
    assert wait(client, job_id)["status"] == "cancelled"
    assert put(client, beats[0]["id"], EDITED).status_code == 200
    # Once direction is open again the manuscript is gone.
    assert reopen(client, 2, title="책").status_code == 200
    assert error(put(client, beats[0]["id"], CLEAN)) == (404, "BEAT_NOT_FOUND")


def test_an_earlier_version_is_put_back_as_the_next_one(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    beat = written[0]["beats"][0]["id"]
    write(conn, beat, 1, "옛 글.")
    write(conn, beat, 2, CLEAN)
    body = restore(client, beat, 1).json()
    assert (body["version"]["version"], body["version"]["text"], body["version"]["origin"]) == (
        3,
        "옛 글.",
        "edited",
    )
    assert wait(client, body["jobId"])["status"] == "done"
    assert [v["text"] for v in listed(client, beat)] == ["옛 글.", CLEAN, "옛 글."]
    # The current text put back again: nothing to do.
    assert restore(client, beat, 3).json()["jobId"] is None
    assert restore(client, beat, 1).json()["jobId"] is None
    assert error(restore(client, beat, 9)) == (404, "VERSION_NOT_FOUND")
    assert error(restore(client, "b_none", 1)) == (404, "BEAT_NOT_FOUND")


def test_a_job_for_a_version_no_longer_current_does_nothing(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    beat = written[0]["beats"][0]["id"]
    write(conn, beat, 1, "옛 글.")
    write(conn, beat, 2, CLEAN)
    state = client.app.state  # type: ignore[attr-defined]

    def submit() -> str:
        return revisions.start_recheck(state.llm.router, state.jobs, state.db_path, "w_01", beat, 1)

    portal = client.portal
    assert portal is not None  # the client runs the app's loop
    job_id = portal.call(submit)
    assert wait(client, job_id)["status"] == "done"
    assert not [1 for request in llm.requests if request.role in ("check", "summary")]
    assert events_of(client, job_id)[-1][1]["result"]["warnings"] == 0
