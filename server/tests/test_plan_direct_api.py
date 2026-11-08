"""Directing a plan scene (§9, §16): the direct job, the user's beats, confirming scenes, and the
advance to writing once every active episode's plan is confirmed (§11)."""

# Fixtures imported from other test modules (conn, client, llm, plan) are redefined as test
# parameters by name; that is how pytest passes them.
# ruff: noqa: F811

import sqlite3
from typing import Any

from fastapi.testclient import TestClient

from aiplot.db import works as works_db
from aiplot.services import direction, plan_scenes
from tests.test_direction_roles import conn  # noqa: F401
from tests.test_draft_messages import Scripted
from tests.test_plan_scenes_api import pick, plan, scenes, set_statuses  # noqa: F401
from tests.test_plans_api import AUTH, client, error, llm, plans, wait  # noqa: F401


def first_card(record: dict[str, Any], number: int) -> str:
    card: str = scenes(record)[number]["recommended"][0]["technique"]
    return card


def direct(client: TestClient, plan_id: str, number: int) -> Any:
    return client.post(f"/api/v1/plans/{plan_id}/scenes/{number}/direct", headers=AUTH)


def directed(client: TestClient, record: dict[str, Any], number: int) -> Any:
    """Picks the scene's first recommended card and directs it; the finished job."""
    pick(client, record["id"], number, [first_card(record, number)])
    response = direct(client, record["id"], number)
    assert response.status_code == 202, response.json()
    return wait(client, response.json()["jobId"])


def put_beats(client: TestClient, plan_id: str, number: int, beats: list[dict[str, Any]]) -> Any:
    return client.put(
        f"/api/v1/plans/{plan_id}/scenes/{number}/beats", headers=AUTH, json={"beats": beats}
    )


def confirm(client: TestClient, plan_id: str, number: int) -> Any:
    return client.post(f"/api/v1/plans/{plan_id}/scenes/{number}/confirm", headers=AUTH)


def beat(summary: str = "테오가 편지를 읽는다.", **changes: Any) -> dict[str, Any]:
    return {
        "summary": summary,
        "techniques": [],
        "pov": "테오 1인칭",
        "mode": "장면화",
        "focus": "감정",
        "density": "자세히",
        "tension": 3,
        "target_chars": 1,
        **changes,
    }


# direct --------------------------------------------------------------------------------------


def test_a_scene_is_directed_by_a_job(client: TestClient, plan: dict[str, Any]) -> None:
    assert error(direct(client, plan["id"], 1)) == (409, "SCENE_NOT_READY")
    job = directed(client, plan, 1)
    assert (job["status"], job["kind"], job["workId"]) == ("done", "direct", "w_01")
    scene = scenes(plans(client)[0])[1]
    assert scene["status"] == "directed"
    assert [b["order"] for b in scene["beats"]] == list(range(1, len(scene["beats"]) + 1))
    assert sum(b["target_chars"] for b in scene["beats"]) == scene["target_chars"]
    # Scene 1 opens its chapter: the cut card (tech_ser_019) is not its to name.
    allowed = {first_card(plan, 1), "tech_ser_042", "tech_ser_020", "tech_ser_021"}
    assert {t for b in scene["beats"] for t in b["techniques"]} <= allowed
    # The others are untouched.
    assert {s["status"] for n, s in scenes(plans(client)[0]).items() if n != 1} == {"undirected"}


def test_an_edit_while_directing_leaves_the_beats_stale(
    client: TestClient, conn: sqlite3.Connection, llm: Scripted, plan: dict[str, Any]
) -> None:
    second = scenes(plan)[1]["recommended"][1]["technique"]

    def change_cards() -> None:
        plan_scenes.pick(conn, plan["id"], 1, [second])

    llm.hooks["direct"] = change_cards
    assert directed(client, plan, 1)["status"] == "done"
    scene = scenes(plans(client)[0])[1]
    assert (scene["status"], scene["chosen"]) == ("stale", [second])
    assert scene["beats"]


def test_a_plan_replaced_while_directing_takes_no_beats(
    client: TestClient, conn: sqlite3.Connection, llm: Scripted, plan: dict[str, Any]
) -> None:
    def drop_plan() -> None:
        conn.execute("DELETE FROM direction_plan")

    llm.hooks["direct"] = drop_plan
    job = directed(client, plan, 1)
    assert (job["status"], job["error"]["code"]) == ("failed", "PLAN_NOT_FOUND")


def test_direct_refusals(
    client: TestClient, conn: sqlite3.Connection, plan: dict[str, Any]
) -> None:
    assert error(direct(client, "pl_none", 1)) == (404, "PLAN_NOT_FOUND")
    assert error(direct(client, plan["id"], 9)) == (404, "SCENE_NOT_FOUND")
    conn.execute("UPDATE work SET stage = 3, locked_stage = 2 WHERE id = 'w_01'")
    assert error(direct(client, plan["id"], 1)) == (423, "STAGE_LOCKED")


# beats ---------------------------------------------------------------------------------------


def test_the_users_beats_are_numbered_and_rescaled(
    client: TestClient, conn: sqlite3.Connection, plan: dict[str, Any]
) -> None:
    assert error(put_beats(client, plan["id"], 1, [beat()])) == (409, "SCENE_NOT_DIRECTED")
    directed(client, plan, 1)
    confirm(client, plan["id"], 1)
    card = first_card(plan, 1)
    beats = [
        beat("  첫 비트 ", techniques=[card, card], target_chars=1),
        beat("둘째 비트", techniques=["tech_ser_042"], target_chars=3),
    ]
    response = put_beats(client, plan["id"], 1, beats)
    assert response.status_code == 200, response.json()
    scene = scenes(response.json())[1]
    target = scene["target_chars"]
    assert [(b["order"], b["summary"], b["techniques"]) for b in scene["beats"]] == [
        (1, "첫 비트", [card]),
        (2, "둘째 비트", ["tech_ser_042"]),
    ]
    assert [b["target_chars"] for b in scene["beats"]] == direction.rescale([1, 3], target)
    # Edited beats need confirming again.
    assert scene["status"] == "directed"


def test_refused_beats(client: TestClient, conn: sqlite3.Connection, plan: dict[str, Any]) -> None:
    directed(client, plan, 1)
    chosen = first_card(plan, 1)
    other = next(r["technique"] for r in scenes(plan)[1]["recommended"] if r["technique"] != chosen)
    # A card not chosen, and the cut card on a chapter's first scene.
    for card in (other, "tech_ser_019"):
        response = put_beats(client, plan["id"], 1, [beat(techniques=[card])])
        assert error(response) == (422, "BEATS_INVALID")
    assert error(put_beats(client, plan["id"], 1, [beat("   ")])) == (422, "VALIDATION_ERROR")
    assert error(put_beats(client, plan["id"], 1, [])) == (422, "VALIDATION_ERROR")
    many = [beat() for _ in range(scenes(plan)[1]["target_chars"] + 1)]
    assert error(put_beats(client, plan["id"], 1, many)) == (422, "BEATS_INVALID")
    # A stale scene's beats may still be edited; it stays stale.
    set_statuses(conn, plan["id"], scene_1="stale")
    scene = scenes(put_beats(client, plan["id"], 1, [beat()]).json())[1]
    assert scene["status"] == "stale"


# confirm and advance -------------------------------------------------------------------------


def test_confirming_scenes_confirms_the_plan(
    client: TestClient, conn: sqlite3.Connection, plan: dict[str, Any]
) -> None:
    assert error(confirm(client, plan["id"], 1)) == (409, "SCENE_NOT_DIRECTED")
    directed(client, plan, 1)
    record = confirm(client, plan["id"], 1).json()
    assert (scenes(record)[1]["status"], record["status"]) == ("confirmed", "directing")
    # Confirming again changes nothing.
    assert confirm(client, plan["id"], 1).status_code == 200
    set_statuses(conn, plan["id"], scene_2="stale")
    assert error(confirm(client, plan["id"], 2)) == (409, "SCENE_NOT_DIRECTED")
    set_statuses(conn, plan["id"], scene_2="directed", scene_3="confirmed", scene_4="confirmed")
    set_statuses(conn, plan["id"], scene_5="confirmed")
    record = confirm(client, plan["id"], 2).json()
    assert record["status"] == "confirmed"
    assert error(confirm(client, "pl_none", 1)) == (404, "PLAN_NOT_FOUND")


def advance(client: TestClient) -> Any:
    return client.post("/api/v1/works/w_01/stage/advance", headers=AUTH)


def test_writing_waits_for_every_active_episode(
    client: TestClient, conn: sqlite3.Connection, plan: dict[str, Any]
) -> None:
    assert works_db.is_active_episode(conn, "c_ep0")
    conn.execute("UPDATE direction_plan SET status = 'confirmed'")
    # 0화 is active too and has no plan.
    assert error(advance(client)) == (409, "STAGE_NOT_READY")
    conn.execute(
        "INSERT INTO direction_plan (id, episode_id, status, plan) "
        "SELECT 'pl_ep0', 'c_ep0', 'directing', plan FROM direction_plan"
    )
    assert error(advance(client)) == (409, "STAGE_NOT_READY")
    conn.execute("UPDATE direction_plan SET status = 'confirmed'")
    response = advance(client)
    assert response.status_code == 200, response.json()
    assert (response.json()["stage"], response.json()["locked_stage"]) == (3, 2)
    # Direction is locked now.
    assert error(confirm(client, plan["id"], 1)) == (423, "STAGE_LOCKED")
    assert error(advance(client)) == (409, "STAGE_FINAL")
