"""Checks of a written beat (§7, §10, §16): the check role's state changes become the beat's state
records, its contradictions warnings on the beat's version; later beats are told the latest
state; a check that fails leaves a warning and the job goes on."""

# Fixtures imported from other test modules (conn, client, llm, plan, written) are redefined as
# test parameters by name; that is how pytest passes them.
# ruff: noqa: F811

import json
import sqlite3
from typing import Any

from fastapi.testclient import TestClient
from pydantic import TypeAdapter

from aiplot.db.checks import StateRow
from aiplot.generated.roles.check_output import CheckOutput
from aiplot.generated.writing.chapter_events import ChapterJobEvent
from aiplot.llm.client import LlmError
from aiplot.services.checks import (
    Cast,
    check_schema,
    clean_state,
    clean_warnings,
    held,
    latest,
)
from aiplot.services.notes import split_sentences
from tests.test_direction_roles import block, conn  # noqa: F401
from tests.test_draft_messages import Scripted
from tests.test_manuscript import count
from tests.test_plan_scenes_api import plan  # noqa: F401
from tests.test_plans_api import AUTH, client, error, llm  # noqa: F401
from tests.test_stage_reopen import reopen
from tests.test_writing import (  # noqa: F401
    BANNED,
    CLEAN,
    PROSE,
    asked,
    finished,
    generate,
    regenerate,
    written,
)

CAST = Cast(
    characters={"테오": "c_teo", "미라": "c_mira"},
    regions={"북부 항구": "c_port", "섬": "c_isle"},
    evidence={"밀물 계약": "c_tide", "북부 항구": "c_port", "섬": "c_isle", "테오": "c_teo"},
)
ENVELOPE = {"key": "item", "card": "테오", "name": "누렇게 바랜 봉투", "action": "gain"}
ENVELOPE_VALUE = {"name": "누렇게 바랜 봉투", "action": "gain"}
HAIR = {"kind": "appearance", "sentence": 1, "card": "테오", "reason": "머리색이 카드와 달라요."}


def output(state: list[dict[str, Any]] | None = None, warnings: list[Any] | None = None) -> str:
    return json.dumps({"state": state or [], "warnings": warnings or []}, ensure_ascii=False)


def parsed(state: list[dict[str, Any]] | None = None, warnings: list[Any] | None = None) -> Any:
    return CheckOutput.model_validate_json(output(state, warnings))


def checks_asked(llm: Scripted) -> list[str]:
    return [r.messages[1]["content"] for r in llm.requests if r.role == "check"]


def state_rows(conn: sqlite3.Connection, beat_id: str | None = None) -> list[tuple[Any, ...]]:
    where = "WHERE beat_id = ?" if beat_id else ""
    rows = conn.execute(
        f"SELECT beat_id, card_id, key, value FROM state_record {where} ORDER BY id",
        (beat_id,) if beat_id else (),
    )
    return [(row[0], row[1], row[2], json.loads(row[3])) for row in rows]


def warnings_of(client: TestClient, chapter_id: str) -> list[dict[str, Any]]:
    response = client.get(f"/api/v1/chapters/{chapter_id}/warnings", headers=AUTH)
    assert response.status_code == 200, response.json()
    found: list[dict[str, Any]] = response.json()["warnings"]
    return found


def patch(client: TestClient, warning_id: str, **body: Any) -> Any:
    return client.patch(f"/api/v1/warnings/{warning_id}", headers=AUTH, json=body)


# pieces ----------------------------------------------------------------------------------------


def test_the_state_is_the_latest_per_character_key_and_subject() -> None:
    sword = {"name": "검", "action": "gain"}
    rows = [
        StateRow("c_teo", "item", sword),
        StateRow("c_teo", "item", {"name": "열쇠", "action": "gain"}),
        StateRow("c_teo", "location", {"region_id": "c_port"}),
        StateRow("c_teo", "location", {"region_id": "c_isle"}),
        StateRow("c_teo", "item", {"name": "열쇠", "action": "lose"}),
        StateRow("c_mira", "item", sword),
    ]
    found = latest(rows)
    # Both items are remembered apart; one location; the other character's own.
    assert list(found.items()) == [
        (("c_teo", "item", "검"), sword),
        (("c_teo", "location", ""), {"region_id": "c_isle"}),
        (("c_teo", "item", "열쇠"), {"name": "열쇠", "action": "lose"}),
        (("c_mira", "item", "검"), sword),
    ]
    assert [held(key, value) for (_, key, _), value in found.items()] == [True, True, False, True]
    healed = {"part": "왼팔", "severity": "보통", "since_chapter": 1, "healed": True}
    assert not held("injury", healed)
    assert held("injury", {**healed, "healed": False})


def test_changes_become_records_of_known_cards() -> None:
    before = [
        StateRow(
            "c_teo",
            "injury",
            {"part": "왼팔", "severity": "가벼움", "since_chapter": 2, "healed": False},
        ),
        StateRow(
            "c_teo", "knows_secret", {"secret": "편지는 삼 년 전에 왔다.", "since_chapter": 1}
        ),
        StateRow("c_teo", "item", {"name": "검", "action": "gain"}),
    ]
    injury = {
        "key": "injury",
        "card": "테오",
        "part": " 왼팔 ",
        "severity": "심함",
        "healed": False,
    }
    found = clean_state(
        parsed(
            [
                {"key": "location", "card": "테오", "region": "섬"},
                {"key": "location", "card": "미라", "region": "없는 곳"},
                {"key": "location", "card": "유령", "region": "섬"},
                injury,
                {"key": "knows_secret", "card": "테오", "secret": "편지는 삼 년 전에 왔다."},
                {"key": "knows_secret", "card": "미라", "secret": "편지는 삼 년 전에 왔다."},
                {"key": "item", "card": "테오", "name": "검", "action": "gain"},
                {"key": "item", "card": "테오", "name": "검", "action": "lose"},
                {"key": "relation_change", "card": "테오", "target": "테오", "change": "화해"},
                {"key": "relation_change", "card": "테오", "target": "미라", "change": "화해했다."},
                {"key": "appearance_change", "card": "미라", "text": "  머리를  잘랐다. "},
            ]
        ),
        CAST,
        4,
        before,
    )
    assert found == [
        StateRow("c_teo", "location", {"region_id": "c_isle"}),
        # The injury got worse: it still dates from the chapter it was first recorded in.
        StateRow(
            "c_teo",
            "injury",
            {"part": "왼팔", "severity": "심함", "since_chapter": 2, "healed": False},
        ),
        # What Teo already knew is not new; Mira learns it in this chapter.
        StateRow(
            "c_mira", "knows_secret", {"secret": "편지는 삼 년 전에 왔다.", "since_chapter": 4}
        ),
        # Said twice: as it was said last.
        StateRow("c_teo", "item", {"name": "검", "action": "lose"}),
        StateRow("c_teo", "relation_change", {"target_id": "c_mira", "change": "화해했다."}),
        StateRow("c_mira", "appearance_change", {"text": "머리를 잘랐다."}),
    ]
    # What the state already holds is not recorded again.
    assert clean_state(parsed([{**injury, "severity": "가벼움"}]), CAST, 4, before) == []


def test_warnings_keep_only_what_the_server_can_place() -> None:
    found = clean_warnings(
        parsed(
            warnings=[
                HAIR,
                HAIR,
                {**HAIR, "sentence": 9},
                {
                    "kind": "world_rule",
                    "sentence": 2,
                    "card": "없는 카드",
                    "reason": " 규칙을  어겼어요. ",
                },
                {"kind": "state", "sentence": 2, "card": None, "reason": "  "},
            ]
        ),
        CAST,
        3,
    )
    assert [(w.kind, w.sentence, w.card_id, w.reason) for w in found] == [
        ("appearance", 1, "c_teo", "머리색이 카드와 달라요."),
        ("appearance", None, "c_teo", "머리색이 카드와 달라요."),
        ("world_rule", 2, None, "규칙을 어겼어요."),
    ]


def test_the_schema_is_narrowed_to_the_names_shown() -> None:
    schema = check_schema(CAST, 7)
    defs = schema["$defs"]
    assert defs["ItemChange"]["properties"]["card"]["enum"] == ["테오", "미라"]
    assert defs["LocationChange"]["properties"]["region"]["enum"] == ["북부 항구", "섬"]
    assert defs["RelationChange"]["properties"]["target"]["enum"] == ["테오", "미라"]
    warning = defs["CheckWarning"]["properties"]
    assert warning["sentence"]["maximum"] == 7
    assert warning["card"]["anyOf"][0]["enum"] == list(CAST.evidence)
    assert len(defs["StateChange"]["anyOf"]) == 6
    # Without regions nobody can move; alone, nobody's ties change; no character, no state.
    alone = check_schema(Cast(characters={"테오": "c_teo"}), 1)
    kept = [ref["$ref"].rsplit("/", 1)[1] for ref in alone["$defs"]["StateChange"]["anyOf"]]
    assert kept == ["InjuryChange", "ItemChange", "SecretChange", "AppearanceChange"]
    assert alone["$defs"]["CheckWarning"]["properties"]["card"] == {"type": "null"}
    assert check_schema(Cast(), 1)["properties"]["state"] == {"type": "array", "maxItems": 0}


# the job ---------------------------------------------------------------------------------------


def test_a_written_beat_is_checked(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    chapter = written[0]
    first = chapter["beats"][0]["id"]
    move = {"key": "location", "card": "테오", "region": "섬"}
    llm.say("check", output([ENVELOPE, move], [HAIR]), output([ENVELOPE]))
    job, events = finished(client, generate(client, chapter["id"]))
    assert job["status"] == "done"
    # §16: the check's events follow the beat's beat_done.
    of_first = [(kind, data) for kind, data in events if kind not in ("progress", "sentence")]
    [warning] = warnings_of(client, chapter["id"])
    assert of_first[2:6] == [
        ("beat_done", {"beatId": first, "chars": of_first[2][1]["chars"], "version": 1}),
        ("state_update", {"cardId": "c_teo", "key": "item", "value": ENVELOPE_VALUE}),
        ("state_update", {"cardId": "c_teo", "key": "location", "value": {"region_id": "c_isle"}}),
        ("warning", {"warningId": warning["id"], "beatId": first, "kind": "appearance"}),
    ]
    assert of_first[6] == ("beat_checked", {"beatId": first, "warnings": 1})
    events_schema: TypeAdapter[Any] = TypeAdapter(ChapterJobEvent)
    for kind, data in events:
        if kind in ("state_update", "warning", "beat_checked"):
            events_schema.validate_python(data)
    assert warning == {
        "id": warning["id"],
        "beat_id": first,
        "version": 1,
        "kind": "appearance",
        "sentence": 1,
        "card_id": "c_teo",
        "status": "open",
        "reason": "머리색이 카드와 달라요.",
        "ignore_reason": None,
    }
    # The later beats' checks said the same of the envelope: recorded once.
    assert state_rows(conn) == [
        (first, "c_teo", "item", ENVELOPE_VALUE),
        (first, "c_teo", "location", {"region_id": "c_isle"}),
    ]
    assert events[-1][1]["result"]["warnings"] == 1
    # The check saw the beat as numbered sentences, the cards by name and no ids.
    seen = checks_asked(llm)
    sentences = split_sentences(PROSE)
    assert block(seen[0], "원문").splitlines()[0] == f"[1] {sentences[0]}"
    assert block(seen[0], "원문").splitlines()[-1] == f"[{len(sentences)}] {sentences[-1]}"
    assert block(seen[0], "상태") == "(기록 없음)"
    assert "인물 테오" in block(seen[0], "참고 카드")
    assert all(mark not in seen[0] for mark in ("c_teo", "c_port", "b_", "ch_"))
    # The next beat, written and checked, is told the state the first one left.
    state = ["테오: 누렇게 바랜 봉투을(를) 가지고 있다", "테오: 지금 있는 곳은 섬"]
    assert block(seen[1], "상태").splitlines() == state
    assert block(asked(llm)[1], "상태").splitlines() == state
    assert "<상태>" not in asked(llm)[0]


def test_a_check_that_fails_twice_leaves_a_warning_and_the_job_goes_on(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    chapter = written[0]
    beats = chapter["beats"]
    llm.say("check", "{", '{"state": 1}', output([ENVELOPE]))
    job, events = finished(client, generate(client, chapter["id"]))
    assert job["status"] == "done"
    assert count(conn, "beat_version") == len(beats)
    [warning] = warnings_of(client, chapter["id"])
    assert (warning["beat_id"], warning["kind"], warning["sentence"], warning["reason"]) == (
        beats[0]["id"],
        "check_failed",
        None,
        "LLM_INVALID_OUTPUT",
    )
    checked = [data for kind, data in events if kind == "beat_checked"]
    assert checked[0] == {"beatId": beats[0]["id"], "warnings": 1}
    assert all(data["warnings"] == 0 for data in checked[1:]) and len(checked) == len(beats)
    # The second beat's check went through.
    assert [row[0] for row in state_rows(conn)] == [beats[1]["id"]]
    assert events[-1][1]["result"]["warnings"] == 1


def test_a_model_failure_in_the_check_fails_the_job_and_keeps_the_beat(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    chapter = written[0]
    llm.failures["check"] = LlmError("LLM_REQUEST_FAILED", "the model went away")
    job, _ = finished(client, generate(client, chapter["id"]))
    assert (job["status"], job["error"]["code"]) == ("failed", "LLM_REQUEST_FAILED")
    assert count(conn, "beat_version") == 1
    assert warnings_of(client, chapter["id"]) == []


def test_a_banned_phrase_kept_in_the_beat_is_a_warning(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    chapter = written[0]
    beat = chapter["beats"][0]
    llm.say("write", BANNED)
    llm.say("check", output(warnings=[HAIR]))
    job, events = finished(client, regenerate(client, beat["id"]))
    assert job["status"] == "done"
    found = warnings_of(client, chapter["id"])
    assert [(w["kind"], w["sentence"], w["card_id"]) for w in found] == [
        ("banned_phrase", None, None),
        ("appearance", 1, "c_teo"),
    ]
    assert found[0]["reason"] and found[0]["reason"] in BANNED
    assert events[-1][1]["result"]["warnings"] == 2


def test_a_beat_written_again_replaces_its_state_and_shows_its_new_warnings(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    chapter = written[0]
    beat = chapter["beats"][0]["id"]
    llm.say("write", CLEAN)
    llm.say("check", output([ENVELOPE], [HAIR]))
    assert finished(client, regenerate(client, beat))[0]["status"] == "done"
    [old] = warnings_of(client, chapter["id"])
    key = {"key": "item", "card": "미라", "name": "열쇠", "action": "gain"}
    llm.say("check", output([key]))
    assert finished(client, regenerate(client, beat))[0]["status"] == "done"
    assert state_rows(conn) == [(beat, "c_mira", "item", {"name": "열쇠", "action": "gain"})]
    # The first version's warning stays with it; the current version has none.
    assert warnings_of(client, chapter["id"]) == []
    assert count(conn, "warning") == 1
    assert patch(client, old["id"], status="ignored").status_code == 200


# warnings (§16) --------------------------------------------------------------------------------


def test_an_ignored_warnings_reason_is_told_to_later_checks(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    chapter = written[0]
    beats = chapter["beats"]
    llm.say("write", CLEAN)
    llm.say("check", output(warnings=[HAIR]), output())
    assert finished(client, regenerate(client, beats[0]["id"]))[0]["status"] == "done"
    [warning] = warnings_of(client, chapter["id"])
    ignored = patch(client, warning["id"], status="ignored", reason="  염색한  장면이다 ")
    assert ignored.status_code == 200
    assert ignored.json() == {**warning, "status": "ignored", "ignore_reason": "염색한 장면이다"}
    assert warnings_of(client, chapter["id"]) == [ignored.json()]
    assert finished(client, regenerate(client, beats[1]["id"]))[0]["status"] == "done"
    order = block(checks_asked(llm)[-1], "지시")
    assert "- 머리색이 카드와 달라요. → 무시한 까닭: 염색한 장면이다" in order.splitlines()
    # Opened again, its reason is gone; a later check is no longer told.
    opened = patch(client, warning["id"], status="open", reason="무시")
    assert opened.json() == warning
    assert finished(client, regenerate(client, beats[1]["id"]))[0]["status"] == "done"
    assert "무시한" not in block(checks_asked(llm)[-1], "지시")
    assert error(patch(client, "wr_none", status="ignored")) == (404, "WARNING_NOT_FOUND")
    assert error(patch(client, warning["id"], status="done")) == (422, "VALIDATION_ERROR")
    missing = client.get("/api/v1/chapters/ch_none/warnings", headers=AUTH)
    assert error(missing) == (404, "CHAPTER_NOT_FOUND")


def test_a_reopen_deletes_the_state_and_the_warnings(
    client: TestClient, conn: sqlite3.Connection, written: list[dict[str, Any]], llm: Scripted
) -> None:
    chapter = written[0]
    llm.say("write", CLEAN)
    llm.say("check", output([ENVELOPE], [HAIR]))
    assert finished(client, regenerate(client, chapter["beats"][0]["id"]))[0]["status"] == "done"
    [warning] = warnings_of(client, chapter["id"])
    assert (count(conn, "state_record"), count(conn, "warning")) == (1, 1)
    assert reopen(client, 2, title="책").status_code == 200
    assert (count(conn, "state_record"), count(conn, "warning")) == (0, 0)
    assert error(patch(client, warning["id"], status="ignored")) == (404, "WARNING_NOT_FOUND")
