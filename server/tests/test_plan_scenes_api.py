"""Editing a stored plan (§9, §16): a scene's devices and cards, the narration order and cuts;
stale scenes; technique_pick kept in step."""

# Fixtures imported from other test modules (conn, client, llm) are redefined as test
# parameters by name; that is how pytest passes them.
# ruff: noqa: F811

import json
import sqlite3
from typing import Any

import pytest
from fastapi.testclient import TestClient

from aiplot.services import direction, techniques
from tests.test_direction_roles import conn  # noqa: F401
from tests.test_plans_api import AUTH, client, directing, error, llm, made, plans  # noqa: F401

CATALOG = techniques.load()
CANDIDATES = [card for card in CATALOG if direction.is_candidate(card)]


@pytest.fixture
def plan(client: TestClient, conn: sqlite3.Connection) -> dict[str, Any]:
    directing(conn)
    made(client)
    [record] = plans(client)
    return record  # type: ignore[no-any-return]


def scenes(record: dict[str, Any]) -> dict[int, dict[str, Any]]:
    return {s["scene"]: s for c in record["plan"]["chapters"] for s in c["scenes"]}


def set_statuses(conn: sqlite3.Connection, plan_id: str, **statuses: str) -> None:
    """scene_3="directed" and so on, written straight into the stored plan."""
    raw = json.loads(
        conn.execute("SELECT plan FROM direction_plan WHERE id = ?", (plan_id,)).fetchone()[0]
    )
    for chapter in raw["chapters"]:
        for scene in chapter["scenes"]:
            scene["status"] = statuses.get(f"scene_{scene['scene']}", scene["status"])
    conn.execute("UPDATE direction_plan SET plan = ? WHERE id = ?", (json.dumps(raw), plan_id))


def all_directed(conn: sqlite3.Connection, record: dict[str, Any]) -> None:
    set_statuses(conn, record["id"], **{f"scene_{n}": "directed" for n in scenes(record)})


def pick_rows(conn: sqlite3.Connection, plan_id: str, scene: int) -> list[tuple[Any, ...]]:
    return [
        (row[0], row[1], json.loads(row[2]), row[3])
        for row in conn.execute(
            "SELECT rank, technique_id, matched, chosen FROM technique_pick "
            "WHERE plan_id = ? AND scene = ? ORDER BY rank IS NULL, rank, id",
            (plan_id, scene),
        )
    ]


def put_devices(client: TestClient, plan_id: str, scene: int, devices: list[str]) -> Any:
    return client.put(
        f"/api/v1/plans/{plan_id}/scenes/{scene}/devices", headers=AUTH, json={"devices": devices}
    )


def pick(client: TestClient, plan_id: str, scene: int, ids: list[str]) -> Any:
    return client.post(
        f"/api/v1/plans/{plan_id}/scenes/{scene}/pick", headers=AUTH, json={"techniques": ids}
    )


def patch(client: TestClient, plan_id: str, layout: list[list[int]]) -> Any:
    return client.patch(f"/api/v1/plans/{plan_id}", headers=AUTH, json={"chapters": layout})


# devices -------------------------------------------------------------------------------------


def test_devices_recompute_the_recommendations(
    client: TestClient,
    conn: sqlite3.Connection,
    plan: dict[str, Any],
) -> None:
    all_directed(conn, plan)
    scene = scenes(plan)[2]
    devices = ["overhear", "knowledge_gap", "overhear"]
    response = put_devices(client, plan["id"], 2, devices)
    assert response.status_code == 200, response.json()
    after = scenes(response.json())[2]
    assert after["devices"] == ["overhear", "knowledge_gap"]
    assert after["ai_devices"] == scene["ai_devices"]
    expected = direction.plan_recommendations(
        conn, ["overhear", "knowledge_gap"], scene["effects"], scene["situations"]
    )
    assert after["recommended"] == [r.model_dump(mode="json") for r in expected]
    assert any(r["devices"] for r in after["recommended"])
    # Devices only change the recommendations: the beats stand.
    assert after["status"] == "directed"
    assert [(rank, t) for rank, t, _, _ in pick_rows(conn, plan["id"], 2)] == [
        (r["rank"], r["technique"]) for r in after["recommended"]
    ]
    unknown = put_devices(client, plan["id"], 2, ["not_a_device"])
    assert error(unknown) == (422, "VALIDATION_ERROR")


# pick ----------------------------------------------------------------------------------------


def test_picked_cards_are_kept_in_order_with_their_rows(
    client: TestClient,
    conn: sqlite3.Connection,
    plan: dict[str, Any],
) -> None:
    scene = scenes(plan)[1]
    recommended = [r["technique"] for r in scene["recommended"]]
    own = next(
        card for card in CANDIDATES if card.id not in recommended and not card.conflicts_with
    )
    first = recommended[0]
    response = pick(client, plan["id"], 1, [own.id, first, own.id])
    assert response.status_code == 200, response.json()
    after = scenes(response.json())[1]
    assert after["chosen"] == [own.id, first]
    # Not directed yet: nothing to make stale.
    assert after["status"] == "undirected"
    rows = pick_rows(conn, plan["id"], 1)
    assert [(rank, t, c) for rank, t, _, c in rows] == [
        *[(r["rank"], r["technique"], int(r["technique"] == first)) for r in scene["recommended"]],
        (None, own.id, 1),
    ]
    shared = direction.shared(own, scene["devices"], scene["effects"], scene["situations"])
    assert rows[-1][2] == {
        "devices": shared.devices,
        "effects": shared.effects,
        "situations": shared.situations,
    }


def test_refused_cards(
    client: TestClient,
    plan: dict[str, Any],
) -> None:
    ids = [card.id for card in CANDIDATES if not card.conflicts_with][:4]
    assert error(pick(client, plan["id"], 1, ids)) == (422, "TOO_MANY_TECHNIQUES")
    assert error(pick(client, plan["id"], 1, ["tech_ser_019"])) == (422, "TECHNIQUE_NOT_CANDIDATE")
    sentence = next(card for card in CATALOG if card.scope == ["문장"])
    assert error(pick(client, plan["id"], 1, [sentence.id])) == (422, "TECHNIQUE_NOT_CANDIDATE")
    assert error(pick(client, plan["id"], 1, ["tech_inf_999"])) == (422, "TECHNIQUE_NOT_CANDIDATE")
    a = next(card for card in CANDIDATES if any(direction.is_candidate(o) for o in conflicts(card)))
    b = next(o for o in conflicts(a) if direction.is_candidate(o))
    assert error(pick(client, plan["id"], 1, [a.id, b.id])) == (422, "TECHNIQUES_CONFLICT")
    assert error(pick(client, plan["id"], 1, [])) == (422, "VALIDATION_ERROR")
    # Nothing refused was kept.
    assert scenes(plans(client)[0])[1]["chosen"] == []


def conflicts(card: Any) -> list[Any]:
    by_id = {c.id: c for c in CATALOG}
    return [by_id[other] for other in card.conflicts_with]


def test_new_cards_make_a_directed_scene_stale(
    client: TestClient,
    conn: sqlite3.Connection,
    plan: dict[str, Any],
) -> None:
    first, second = [r["technique"] for r in scenes(plan)[1]["recommended"][:2]]
    pick(client, plan["id"], 1, [first])
    all_directed(conn, plan)
    set_statuses(conn, plan["id"], scene_1="confirmed")
    # The same cards again: the beats still fit.
    assert scenes(pick(client, plan["id"], 1, [first]).json())[1]["status"] == "confirmed"
    record = pick(client, plan["id"], 1, [first, second]).json()
    assert scenes(record)[1]["status"] == "stale"
    assert scenes(record)[2]["status"] == "directed"


def test_the_plan_is_confirmed_while_every_scene_is(
    client: TestClient,
    conn: sqlite3.Connection,
    plan: dict[str, Any],
) -> None:
    first = scenes(plan)[1]["recommended"][0]["technique"]
    set_statuses(conn, plan["id"], **{f"scene_{n}": "confirmed" for n in scenes(plan)})
    assert put_devices(client, plan["id"], 1, []).json()["status"] == "confirmed"
    # A card for scene 1 makes it stale: the plan is no longer confirmed.
    assert pick(client, plan["id"], 1, [first]).json()["status"] == "directing"
    assert conn.execute("SELECT status FROM direction_plan").fetchone()[0] == "directing"


# narration order and cuts --------------------------------------------------------------------


def layout(record: dict[str, Any]) -> list[list[int]]:
    return [[s["scene"] for s in c["scenes"]] for c in record["plan"]["chapters"]]


def test_scenes_whose_place_changed_become_stale(
    client: TestClient,
    conn: sqlite3.Connection,
    plan: dict[str, Any],
) -> None:
    assert layout(plan) == [[1, 2, 3], [4, 5]]
    all_directed(conn, plan)
    set_statuses(conn, plan["id"], scene_1="confirmed", scene_2="undirected")
    # 5 before 4: 3's next scene, 4's and 5's places and neighbours change; 1 and 2 keep theirs
    # (targets come from the same weights).
    response = patch(client, plan["id"], [[1, 2, 3], [5, 4]])
    assert response.status_code == 200, response.json()
    record = response.json()
    assert layout(record) == [[1, 2, 3], [5, 4]]
    statuses = {n: s["status"] for n, s in scenes(record).items()}
    assert statuses == {1: "confirmed", 2: "undirected", 3: "stale", 4: "stale", 5: "stale"}
    before = scenes(plan)
    assert all(s["target_chars"] == before[n]["target_chars"] for n, s in scenes(record).items())


def test_a_moved_cut_rescales_the_chapters(
    client: TestClient,
    conn: sqlite3.Connection,
    plan: dict[str, Any],
) -> None:
    all_directed(conn, plan)
    record = patch(client, plan["id"], [[1, 2], [3, 4, 5]]).json()
    chapters = record["plan"]["chapters"]
    assert [c["chapter"] for c in chapters] == [1, 2]
    for chapter in chapters:
        assert chapter["target_chars"] == 5500
        assert sum(s["target_chars"] for s in chapter["scenes"]) == 5500
    before = scenes(plan)
    old = [before[n]["target_chars"] for n in (1, 2)]
    assert [s["target_chars"] for s in chapters[0]["scenes"]] == direction.rescale(old, 5500)
    assert {s["status"] for s in scenes(record).values()} == {"stale"}
    # One chapter for all: still valid.
    one = patch(client, plan["id"], [[1, 2, 3, 4, 5]]).json()
    assert layout(one) == [[1, 2, 3, 4, 5]]


@pytest.mark.parametrize(
    "bad",
    [
        [[1, 2, 3], [4]],
        [[1, 2, 3], [4, 5, 5]],
        [[1, 2, 3], [], [4, 5]],
        [[1, 2, 3], [4, 5, 6]],
        [[1], [2], [3], [4], [5], []],
        [],
    ],
)
def test_bad_layouts(client: TestClient, plan: dict[str, Any], bad: list[list[int]]) -> None:
    assert error(patch(client, plan["id"], bad)) == (422, "PLAN_LAYOUT_INVALID")
    assert layout(plans(client)[0]) == [[1, 2, 3], [4, 5]]


# refusals ------------------------------------------------------------------------------------


def test_edits_need_the_plan_the_scene_and_the_stage(
    client: TestClient,
    conn: sqlite3.Connection,
    plan: dict[str, Any],
) -> None:
    assert error(put_devices(client, "pl_none", 1, [])) == (404, "PLAN_NOT_FOUND")
    assert error(put_devices(client, plan["id"], 9, [])) == (404, "SCENE_NOT_FOUND")
    assert error(pick(client, plan["id"], 9, [CANDIDATES[0].id])) == (404, "SCENE_NOT_FOUND")
    assert error(patch(client, "pl_none", [[1]])) == (404, "PLAN_NOT_FOUND")
    conn.execute("UPDATE work SET stage = 3, locked_stage = 2 WHERE id = 'w_01'")
    assert error(put_devices(client, plan["id"], 1, [])) == (423, "STAGE_LOCKED")
    assert error(pick(client, plan["id"], 1, [CANDIDATES[0].id])) == (423, "STAGE_LOCKED")
    assert error(patch(client, plan["id"], [[1, 2, 3, 4, 5]])) == (423, "STAGE_LOCKED")
    assert plans(client)[0] == plan
