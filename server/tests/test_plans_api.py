"""Direction plans (§9, §14, §16): made by a job from `scene` then `arrange`, one per episode,
only while direction is the current stage."""

# Fixtures imported from other test modules (conn, client, llm) are redefined as test
# parameters by name; that is how pytest passes them.
# ruff: noqa: F811

import sqlite3
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from aiplot.llm.client import LlmError
from aiplot.llm.config import load_llm_config
from aiplot.llm.fake import load_fixtures
from aiplot.llm.router import Router
from aiplot.llm.runtime import LlmRuntime, fake_runtime
from aiplot.main import create_app
from aiplot.services import cards, works
from tests.test_cards import save
from tests.test_direction_roles import conn, ep  # noqa: F401
from tests.test_draft_messages import Scripted

TOKEN = "test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def llm() -> Scripted:
    """The fixture answers (scene: five scenes, arrange: two chapters), scriptable per test."""
    client = Scripted()
    for role, response in load_fixtures().items():
        client.script[role] = [response]
    return client


@pytest.fixture
def client(tmp_path: Path, conn: sqlite3.Connection, llm: Scripted) -> Iterator[TestClient]:
    base = fake_runtime(tmp_path)
    runtime = LlmRuntime(Router(load_llm_config(), llm, lora_dir=tmp_path / "lora"), base.setup)
    app = create_app(token=TOKEN, db_path=tmp_path / "data" / "aiplot.db", llm=runtime)
    with TestClient(app) as c:
        yield c


def directing(conn: sqlite3.Connection) -> None:
    works.advance(conn, "w_01")


def post(client: TestClient, episode_id: str = "c_ep1", **params: Any) -> Any:
    return client.post(f"/api/v1/episodes/{episode_id}/plans", headers=AUTH, params=params)


def wait(client: TestClient, job_id: str) -> Any:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        job = client.get(f"/api/v1/jobs/{job_id}", headers=AUTH).json()
        if job["status"] in ("done", "failed", "cancelled"):
            return job
        time.sleep(0.02)
    raise AssertionError("the plan job did not finish")


def made(client: TestClient, episode_id: str = "c_ep1", **params: Any) -> Any:
    response = post(client, episode_id, **params)
    assert response.status_code == 202, response.json()
    return wait(client, response.json()["jobId"])


def plans(client: TestClient, episode_id: str = "c_ep1") -> Any:
    response = client.get(f"/api/v1/episodes/{episode_id}/plans", headers=AUTH)
    assert response.status_code == 200, response.json()
    return response.json()["plans"]


def error(response: Any) -> tuple[int, str]:
    return response.status_code, response.json()["code"]


def picks(conn: sqlite3.Connection, plan_id: str) -> list[tuple[Any, ...]]:
    return [
        tuple(row)
        for row in conn.execute(
            "SELECT scene, rank, technique_id, chosen FROM technique_pick WHERE plan_id = ? "
            "ORDER BY scene, rank",
            (plan_id,),
        )
    ]


def test_a_plan_is_made_from_scene_and_arrange(
    client: TestClient,
    conn: sqlite3.Connection,
) -> None:
    directing(conn)
    assert plans(client) == []
    job = made(client)
    assert job["status"] == "done", job
    [record] = plans(client)
    assert record["id"].startswith("pl_")
    assert (record["episode_id"], record["status"]) == ("c_ep1", "directing")
    plan = record["plan"]
    # The arrange fixture: scenes 1-3, then 4-5, each chapter's targets summing to 5500.
    assert [[s["scene"] for s in c["scenes"]] for c in plan["chapters"]] == [[1, 2, 3], [4, 5]]
    for chapter in plan["chapters"]:
        assert sum(s["target_chars"] for s in chapter["scenes"]) == 5500
    scenes = [s for c in plan["chapters"] for s in c["scenes"]]
    assert {s["status"] for s in scenes} == {"undirected"}
    assert all(s["chosen"] == [] and s["beats"] == [] for s in scenes)
    # technique_pick mirrors every scene's recommended cards, none chosen yet.
    expected = [
        (s["scene"], r["rank"], r["technique"], 0)
        for s in sorted(scenes, key=lambda s: s["scene"])
        for r in s["recommended"]
    ]
    assert expected
    assert picks(conn, record["id"]) == expected
    assert job["kind"] == "plan" and job["workId"] == "w_01"


def test_one_plan_per_episode_unless_replaced(
    client: TestClient,
    conn: sqlite3.Connection,
) -> None:
    directing(conn)
    made(client)
    [first] = plans(client)
    assert error(post(client)) == (409, "PLAN_EXISTS")
    assert made(client, replace="true")["status"] == "done"
    [second] = plans(client)
    assert second["id"] != first["id"]
    assert picks(conn, first["id"]) == []
    assert picks(conn, second["id"])


def test_plans_wait_for_the_direction_stage(
    client: TestClient,
    conn: sqlite3.Connection,
) -> None:
    assert error(post(client)) == (409, "STAGE_NOT_STARTED")
    directing(conn)
    conn.execute("UPDATE work SET stage = 3, locked_stage = 2 WHERE id = 'w_01'")
    assert error(post(client)) == (423, "STAGE_LOCKED")
    # Reading stays open.
    assert plans(client) == []


def test_only_active_episodes_get_plans(
    client: TestClient,
    conn: sqlite3.Connection,
) -> None:
    save(conn, ep("c_ep9", "9화", synopsis=None))
    assert cards.get(conn, "c_ep9").status == "incomplete"  # type: ignore[union-attr]
    directing(conn)
    assert error(post(client, "c_ep9")) == (409, "EPISODE_NOT_READY")
    assert error(post(client, "c_teo")) == (409, "EPISODE_NOT_READY")
    assert error(post(client, "c_none")) == (404, "CARD_NOT_FOUND")
    no_card = client.get("/api/v1/episodes/c_none/plans", headers=AUTH)
    assert error(no_card) == (404, "CARD_NOT_FOUND")


def test_a_stage_locked_while_the_roles_ran_keeps_the_plan_out(
    client: TestClient,
    conn: sqlite3.Connection,
    llm: Scripted,
) -> None:
    directing(conn)

    def lock() -> None:
        conn.execute("UPDATE work SET stage = 3, locked_stage = 2 WHERE id = 'w_01'")

    llm.hooks["arrange"] = lock
    job = made(client)
    assert (job["status"], job["error"]["code"]) == ("failed", "STAGE_LOCKED")
    assert plans(client) == []


def test_a_failed_role_fails_the_job(
    client: TestClient,
    conn: sqlite3.Connection,
    llm: Scripted,
) -> None:
    directing(conn)
    llm.failures["scene"] = LlmError("LLM_UNAVAILABLE", "no model")
    job = made(client)
    assert (job["status"], job["error"]["code"]) == ("failed", "LLM_UNAVAILABLE")
    assert plans(client) == []


def test_the_plan_goes_with_its_work(
    client: TestClient,
    conn: sqlite3.Connection,
) -> None:
    directing(conn)
    made(client)
    assert client.delete("/api/v1/works/w_01", headers=AUTH).status_code == 204
    assert conn.execute("SELECT count(*) FROM direction_plan").fetchone()[0] == 0
    assert conn.execute("SELECT count(*) FROM technique_pick").fetchone()[0] == 0
