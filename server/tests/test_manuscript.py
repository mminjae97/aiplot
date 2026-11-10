"""The manuscript's chapters and beats (§11, §14, §16): made from the confirmed plans when writing
starts, listed by GET /works/{workId}/chapters, deleted (after a snapshot) by a reopen."""

# Fixtures imported from other test modules (conn, client, llm, plan) are redefined as test
# parameters by name; that is how pytest passes them.
# ruff: noqa: F811

import json
import sqlite3
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from aiplot.db import chapters as chapters_db
from aiplot.db import snapshots as snapshots_db
from tests.test_direction_roles import conn  # noqa: F401
from tests.test_plan_direct_api import advance, confirm, directed
from tests.test_plan_scenes_api import plan, scenes  # noqa: F401
from tests.test_plans_api import AUTH, client, error, llm, plans  # noqa: F401
from tests.test_stage_reopen import get, reopen, snapshots, stage_of


def chapters(client: TestClient, work_id: str = "w_01") -> Any:
    response = client.get(f"/api/v1/works/{work_id}/chapters", headers=AUTH)
    assert response.status_code == 200, response.json()
    return response.json()["chapters"]


def count(conn: sqlite3.Connection, table: str) -> int:
    return int(conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0])


def confirmed(client: TestClient, conn: sqlite3.Connection, record: dict[str, Any]) -> Any:
    """Directs and confirms every scene of 1화's plan, gives 0화 (active too) a confirmed copy
    told after it, and returns 1화's plan as stored."""
    for number in scenes(record):
        assert directed(client, record, number)["status"] == "done"
        assert confirm(client, record["id"], number).status_code == 200
    [stored] = plans(client)
    assert stored["status"] == "confirmed"
    conn.execute(
        "INSERT INTO direction_plan (id, episode_id, status, plan) "
        "SELECT 'pl_ep0', 'c_ep0', 'confirmed', plan FROM direction_plan"
    )
    # 0화 was made first; the story order puts it second.
    conn.execute("UPDATE episode SET \"order\" = 1 WHERE card_id = 'c_ep1'")
    conn.execute("UPDATE episode SET \"order\" = 2 WHERE card_id = 'c_ep0'")
    return stored


def write(conn: sqlite3.Connection, beat_id: str, version: int, text: str) -> None:
    conn.execute(
        "INSERT INTO beat_version (beat_id, version, text, chars, origin, created_at) "
        "VALUES (?, ?, ?, ?, 'generated', '2026-11-10T00:00:00Z')",
        (beat_id, version, text, len(text)),
    )


def test_starting_writing_turns_the_plans_into_chapters_and_beats(
    client: TestClient, conn: sqlite3.Connection, plan: dict[str, Any]
) -> None:
    assert chapters(client) == []
    stored = confirmed(client, conn, plan)
    assert chapters(client) == []
    assert advance(client).status_code == 200
    made = chapters(client)
    # Two plans of two chapters each, numbered through the work in story order.
    assert [c["number"] for c in made] == [1, 2, 3, 4]
    assert [c["episode_id"] for c in made] == ["c_ep1", "c_ep1", "c_ep0", "c_ep0"]
    assert [c["plan_id"] for c in made] == [stored["id"]] * 2 + ["pl_ep0"] * 2
    assert all(c["id"].startswith("ch_") and not c["read"] and c["chars"] == 0 for c in made)
    for chapter, planned in zip(made, stored["plan"]["chapters"] * 2, strict=True):
        assert chapter["target_chars"] == planned["target_chars"]
        # The chapter's beats: its scenes' beats in narration order, numbered through.
        expected = [
            {
                **{key: value for key, value in beat.items() if key != "order"},
                "scene": scene["scene"],
                "source_stage": scene["source"],
            }
            for scene in planned["scenes"]
            for beat in scene["beats"]
        ]
        assert expected
        assert [b["order"] for b in chapter["beats"]] == list(range(1, len(expected) + 1))
        for beat, wanted in zip(chapter["beats"], expected, strict=True):
            assert beat["id"].startswith("b_")
            assert (beat["version"], beat["chars"]) == (None, None)
            assert {key: beat[key] for key in wanted} == wanted
        assert sum(b["target_chars"] for b in chapter["beats"]) == chapter["target_chars"]
    assert len({b["id"] for c in made for b in c["beats"]}) == count(conn, "beat")
    assert error(client.get("/api/v1/works/w_none/chapters", headers=AUTH)) == (
        404,
        "WORK_NOT_FOUND",
    )
    assert client.get("/api/v1/works/w_01/chapters").status_code == 401


def test_only_active_episodes_confirmed_plans_are_written(
    client: TestClient, conn: sqlite3.Connection, plan: dict[str, Any]
) -> None:
    confirmed(client, conn, plan)
    # A plan left behind by an episode that is not active is no part of the manuscript.
    conn.execute("UPDATE card SET status = 'incomplete' WHERE id = 'c_ep0'")
    assert advance(client).status_code == 200
    assert [c["episode_id"] for c in chapters(client)] == ["c_ep1", "c_ep1"]


def test_a_beat_names_each_card_once(
    client: TestClient, conn: sqlite3.Connection, plan: dict[str, Any]
) -> None:
    stored = confirmed(client, conn, plan)
    raw = stored["plan"]
    first = raw["chapters"][0]["scenes"][0]["beats"][0]
    first["techniques"] = [*first["techniques"], *first["techniques"]]
    conn.execute("UPDATE direction_plan SET plan = ? WHERE id = ?", (json.dumps(raw), stored["id"]))
    assert advance(client).status_code == 200
    beat = chapters(client)[0]["beats"][0]
    assert beat["techniques"] == first["techniques"][: len(first["techniques"]) // 2]


def test_the_list_shows_what_is_written(
    client: TestClient, conn: sqlite3.Connection, plan: dict[str, Any]
) -> None:
    confirmed(client, conn, plan)
    advance(client)
    first, second = (b["id"] for b in chapters(client)[0]["beats"][:2])
    write(conn, first, 1, "테오가 항구에 닿았다.")
    write(conn, first, 2, "테오가 안개 낀 항구에 닿았다.")
    write(conn, second, 1, "미라가 기다렸다.")
    made = chapters(client)
    beats = made[0]["beats"]
    # The latest version is the current one; chars count spaces.
    assert (beats[0]["version"], beats[0]["chars"]) == (2, 17)
    assert (beats[1]["version"], beats[1]["chars"]) == (1, 9)
    assert (beats[2]["version"], beats[2]["chars"]) == (None, None)
    assert [c["chars"] for c in made] == [26, 0, 0, 0]


def test_reopening_direction_deletes_the_manuscript(
    client: TestClient, conn: sqlite3.Connection, plan: dict[str, Any], tmp_path: Path
) -> None:
    confirmed(client, conn, plan)
    advance(client)
    # Nothing written yet: no chapter is counted and no title is asked for.
    preview = get(client, "reopen-preview", stage=2).json()
    assert preview == {"stage": 2, "plans": 0, "chapters": 0, "title_required": False}
    made = chapters(client)
    write(conn, made[0]["beats"][0]["id"], 1, "테오가 항구에 닿았다.")
    write(conn, made[2]["beats"][0]["id"], 1, "0화가 시작됐다.")
    preview = get(client, "reopen-preview", stage=2).json()
    assert preview == {"stage": 2, "plans": 0, "chapters": 2, "title_required": True}
    assert error(reopen(client, 2)) == (422, "TITLE_MISMATCH")
    assert error(reopen(client, 2, title="다른 책")) == (422, "TITLE_MISMATCH")
    assert count(conn, "chapter") == 4 and snapshots(tmp_path) == []
    assert reopen(client, 2, title=" 책 ").status_code == 200
    assert stage_of(conn) == (2, 1)
    # The manuscript is gone with everything under it; the plans stay.
    for table in ("chapter", "beat", "beat_technique", "beat_version"):
        assert count(conn, table) == 0
    assert count(conn, "direction_plan") == 2
    assert chapters(client) == []
    # The snapshot was taken before: it still holds the manuscript.
    [copy] = snapshots(tmp_path)
    held = sqlite3.connect(copy)
    try:
        assert held.execute("SELECT count(*) FROM chapter").fetchone()[0] == 4
        assert held.execute("SELECT count(*) FROM beat_version").fetchone()[0] == 2
    finally:
        held.close()
    # Writing starts again from the plans: new chapters, nothing written.
    assert advance(client).status_code == 200
    again = chapters(client)
    assert len(again) == 4 and all(c["chars"] == 0 for c in again)
    assert not {c["id"] for c in again} & {c["id"] for c in made}


def test_reopening_planning_deletes_the_plans_and_the_manuscript(
    client: TestClient, conn: sqlite3.Connection, plan: dict[str, Any]
) -> None:
    confirmed(client, conn, plan)
    advance(client)
    write(conn, chapters(client)[0]["beats"][0]["id"], 1, "테오가 항구에 닿았다.")
    preview = get(client, "reopen-preview", stage=1).json()
    assert preview == {"stage": 1, "plans": 2, "chapters": 1, "title_required": True}
    assert reopen(client, 1, title="책").status_code == 200
    assert stage_of(conn) == (1, 0)
    for table in ("direction_plan", "chapter", "beat", "beat_technique", "beat_version"):
        assert count(conn, table) == 0


def test_deleting_the_work_deletes_its_manuscript(
    client: TestClient, conn: sqlite3.Connection, plan: dict[str, Any]
) -> None:
    confirmed(client, conn, plan)
    advance(client)
    write(conn, chapters(client)[0]["beats"][0]["id"], 1, "테오가 항구에 닿았다.")
    assert client.delete("/api/v1/works/w_01", headers=AUTH).status_code == 204
    for table in ("chapter", "beat", "beat_technique", "beat_version"):
        assert count(conn, table) == 0


def test_chapters_follow_the_parts_then_the_order_then_creation(
    client: TestClient, conn: sqlite3.Connection, plan: dict[str, Any]
) -> None:
    confirmed(client, conn, plan)
    # The same order in a part: as the episodes were made (0화 first).
    conn.execute('UPDATE episode SET "order" = 1')
    assert advance(client).status_code == 200
    assert [c["episode_id"] for c in chapters(client)] == ["c_ep0", "c_ep0", "c_ep1", "c_ep1"]
    assert reopen(client, 2).status_code == 200
    # 1화 moves to a part of its own told first: the part's order wins over the episode's.
    part = conn.execute("SELECT part_id FROM episode WHERE card_id = 'c_ep1'").fetchone()[0]
    conn.execute(
        "INSERT INTO card (id, work_id, type, name, source_notes, data, evidence, ai_guess, "
        "pinned_fields, status, schema_version) SELECT 'c_part0', work_id, type, '앞 부', "
        "source_notes, data, evidence, ai_guess, pinned_fields, status, schema_version "
        "FROM card WHERE id = ?",
        (part,),
    )
    conn.execute(
        'INSERT INTO part (card_id, main_id, "order", start, "end") '
        "SELECT 'c_part0', main_id, 0, start, \"end\" FROM part WHERE card_id = ?",
        (part,),
    )
    conn.execute("UPDATE episode SET part_id = 'c_part0', \"order\" = 9 WHERE card_id = 'c_ep1'")
    assert advance(client).status_code == 200
    assert [c["episode_id"] for c in chapters(client)] == ["c_ep1", "c_ep1", "c_ep0", "c_ep0"]


def test_a_failed_start_leaves_direction_open(
    client: TestClient,
    conn: sqlite3.Connection,
    plan: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    confirmed(client, conn, plan)
    made = chapters_db.insert_beat
    calls = []

    def fail_late(*args: Any) -> None:
        calls.append(args)
        if len(calls) > 3:
            raise sqlite3.IntegrityError("no more beats")
        made(*args)

    monkeypatch.setattr(chapters_db, "insert_beat", fail_late)
    with pytest.raises(sqlite3.IntegrityError):
        advance(client)
    assert stage_of(conn) == (2, 1)
    assert count(conn, "chapter") == 0 and count(conn, "beat") == 0


def test_text_written_during_the_snapshot_still_needs_the_title(
    client: TestClient,
    conn: sqlite3.Connection,
    plan: dict[str, Any],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    confirmed(client, conn, plan)
    advance(client)
    beat_id = chapters(client)[0]["beats"][0]["id"]
    copy = snapshots_db.copy_database

    def copy_then_write(source: sqlite3.Connection, target: Path) -> None:
        copy(source, target)
        write(conn, beat_id, 1, "테오가 항구에 닿았다.")

    monkeypatch.setattr(snapshots_db, "copy_database", copy_then_write)
    # No title was needed when the reopen began; the first beat arrived before it deleted.
    assert error(reopen(client, 2)) == (422, "TITLE_MISMATCH")
    assert stage_of(conn) == (3, 2)
    assert count(conn, "beat_version") == 1 and snapshots(tmp_path) == []
