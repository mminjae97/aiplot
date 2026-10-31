"""카드 생성 and 저장 (§8, §13): the card role's output is cleaned, placed and saved."""

import json
import sqlite3
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from aiplot.db.connection import connect
from aiplot.db.migrate import init_db
from aiplot.llm.client import LlmError
from aiplot.llm.config import load_llm_config
from aiplot.llm.router import Router
from aiplot.llm.runtime import LlmRuntime, fake_runtime
from aiplot.main import create_app
from aiplot.services import draft_card
from tests.test_card_delete import episode
from tests.test_cards import character, fixture, region, save, story
from tests.test_draft_messages import Scripted

TOKEN = "test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
NOTES = "테오는 북부 항구 출신이다. 말수가 적다."


def output(card_type: str, value: dict[str, Any], **changes: Any) -> str:
    """A card role answer built from a card fixture."""
    answer = {
        "type": card_type,
        "name": value["name"],
        "data": value["data"],
        "evidence": {"theme": [0]},
        "ai_guess": [],
        **changes,
    }
    return json.dumps(answer, ensure_ascii=False)


@pytest.fixture
def llm() -> Scripted:
    client = Scripted()
    client.say("card", output("character", fixture("character")))
    return client


@pytest.fixture
def conn(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    path = tmp_path / "data" / "aiplot.db"
    init_db(path)
    conn = connect(path)
    conn.execute(
        "INSERT INTO work (id, title, updated_at) VALUES ('w_01', '책', '2026-10-31T00:00:00Z')"
    )
    yield conn
    conn.close()


@pytest.fixture
def client(tmp_path: Path, conn: sqlite3.Connection, llm: Scripted) -> Iterator[TestClient]:
    base = fake_runtime(tmp_path)
    runtime = LlmRuntime(Router(load_llm_config(), llm, lora_dir=tmp_path / "lora"), base.setup)
    app = create_app(token=TOKEN, db_path=tmp_path / "data" / "aiplot.db", llm=runtime)
    # The job queue runs in the app's lifespan.
    with TestClient(app) as c:
        yield c


def open_draft(client: TestClient, body: dict[str, Any], notes: str = NOTES) -> str:
    response = client.post("/api/v1/works/w_01/drafts", headers=AUTH, json=body)
    assert response.status_code == 201, response.json()
    draft_id: str = response.json()["id"]
    client.put(f"/api/v1/drafts/{draft_id}/source", headers=AUTH, json={"notes": notes})
    return draft_id


def generate(client: TestClient, draft_id: str, body: dict[str, Any] | None = None) -> Any:
    response = client.post(f"/api/v1/drafts/{draft_id}/generate", headers=AUTH, json=body or {})
    assert response.status_code == 202, response.json()
    job_id = response.json()["jobId"]
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        job = client.get(f"/api/v1/jobs/{job_id}", headers=AUTH).json()
        if job["status"] in ("done", "failed", "cancelled"):
            return job
        time.sleep(0.02)
    raise AssertionError("generation did not finish")


def generated(client: TestClient, draft_id: str) -> Any:
    return client.get(f"/api/v1/drafts/{draft_id}", headers=AUTH).json()["generated"]


def save_draft(client: TestClient, draft_id: str) -> Any:
    return client.post(f"/api/v1/drafts/{draft_id}/save", headers=AUTH)


def error(response: Any) -> tuple[int, str]:
    return response.status_code, response.json()["code"]


def test_generate_cleans_and_save_writes(
    client: TestClient, conn: sqlite3.Connection, llm: Scripted
) -> None:
    save(conn, region("c_port", "북부 항구"))
    save(conn, character("c_mira", "미라", relations=[]))
    value = fixture("character")
    value["data"] = {
        **value["data"],
        "relations": [
            {"target_id": "c_mira", "relation": "소꿉친구"},
            {"target_id": "c_ghost", "relation": "없는 인물"},
        ],
    }
    llm.say(
        "card",
        output(
            "character",
            value,
            evidence={"theme": [0, 9], "personality.traits": [1], "wings": [0], "speech": [5]},
            ai_guess=["speech.examples", "wings", "speech.examples"],
        ),
    )
    draft_id = open_draft(client, {"type": "character"})
    assert generate(client, draft_id)["status"] == "done"
    card = generated(client, draft_id)
    assert card["data"]["relations"] == [{"target_id": "c_mira", "relation": "소꿉친구"}]
    assert card["data"]["origin_region_id"] == "c_port"
    # Indexes past the two sentences and paths the card does not have are gone.
    assert card["evidence"] == {"theme": [0], "personality.traits": [1]}
    assert card["ai_guess"] == ["speech.examples"]
    prompt = llm.requests[-1].messages[-1]["content"]
    assert "<원문>\n[0] 테오는 북부 항구 출신이다.\n[1] 말수가 적다.\n</원문>" in prompt
    assert prompt.endswith("<지시>\n카드 종류: character\n</지시>")

    response = save_draft(client, draft_id)
    assert response.status_code == 200, response.json()
    saved = response.json()
    assert saved["id"].startswith("c_") and saved["source_notes"] == NOTES
    assert saved["status"] == "complete"
    assert (
        conn.execute(
            "SELECT to_id FROM char_relation WHERE from_id = ?", (saved["id"],)
        ).fetchall()[0][0]
        == "c_mira"
    )
    # Saving closes the drawer.
    assert client.get(f"/api/v1/drafts/{draft_id}", headers=AUTH).status_code == 404


def test_world_context_category_and_budget(
    client: TestClient, conn: sqlite3.Connection, llm: Scripted
) -> None:
    llm.say("card", output("world", fixture("world")))
    llm.say("chat", "어떤 세력인가요?")
    save(conn, fixture("world", id="c_tide"))
    draft_id = open_draft(client, {"type": "world", "category": "faction"})
    generate(client, draft_id)
    prompt = llm.requests[-1].messages[-1]["content"]
    assert "카드 종류: world. 분류: faction" in prompt
    assert "c_tide 세계관 " in prompt and "규칙·능력 · " in prompt
    # Many world cards: names and categories only, except the ones @-mentioned.
    for n in range(40):
        save(conn, fixture("world", id=f"c_w{n}", name=f"세계 {n}"))
    client.post(
        f"/api/v1/drafts/{draft_id}/messages", headers=AUTH, json={"text": "", "refs": ["c_w7"]}
    )
    generate(client, draft_id)
    refs = llm.requests[-1].messages[-1]["content"].split("<참고 카드>\n")[1]
    assert "c_w3 세계관 세계 3 (규칙·능력)" in refs
    assert "c_w7 세계관 세계 7: 규칙·능력 · " in refs


def test_milestone_ids_are_the_servers_and_stay(
    client: TestClient, conn: sqlite3.Connection, llm: Scripted
) -> None:
    main = fixture("main-story", id="c_main")
    texts = [m["text"] for m in main["data"]["milestones"]]
    answer = {
        **main["data"],
        "milestones": [
            {"id": f"ms_{i + 1}", "order": i + 1, "text": t} for i, t in enumerate(texts)
        ],
    }
    llm.say("card", output("main_story", {"name": main["name"], "data": answer}))
    draft_id = open_draft(client, {"type": "main_story"})
    generate(client, draft_id)
    first = [m["id"] for m in generated(client, draft_id)["data"]["milestones"]]
    assert all(i.startswith("ms_") and i not in ("ms_1", "ms_2") for i in first)
    saved = save_draft(client, draft_id).json()
    # Regenerated with one text changed: the unchanged ones keep their ids.
    answer["milestones"][0]["text"] = "바뀐 사건"
    llm.say("card", output("main_story", {"name": main["name"], "data": answer}))
    draft_id = open_draft(
        client, {"type": "main_story", "card_id": saved["id"]}, saved["source_notes"]
    )
    generate(client, draft_id)
    again = [m["id"] for m in generated(client, draft_id)["data"]["milestones"]]
    assert again[0] != first[0] and again[1:] == first[1:]


def test_a_new_episode_goes_last_in_its_part(
    client: TestClient, conn: sqlite3.Connection, llm: Scripted
) -> None:
    story(conn)
    save(
        conn,
        episode(
            "c_e1",
            part_id="c_part1",
            order=1,
            foreshadowing={"plants": [{"id": "fs_a", "text": "편지"}], "payoffs": []},
        ),
    )
    save(
        conn,
        episode(
            "c_e2", part_id="c_part1", order=2, links={"prev": "c_e1", "next": None, "causes": []}
        ),
    )
    value = episode("c_new")
    value["data"] = {
        **value["data"],
        "part_id": "c_ghost",
        "order": 99,
        "links": {"prev": "c_ghost", "next": "c_e1", "causes": ["c_e1", "c_ghost"]},
        "foreshadowing": {"plants": [{"id": "fs_1", "text": "열쇠"}], "payoffs": ["fs_a", "fs_1"]},
        "characters": ["c_teo", "c_ghost"],
        "locations": {"main": "c_port", "others": ["c_port", "c_isle"]},
    }
    llm.say("card", output("episode", value))
    draft_id = open_draft(client, {"type": "episode", "part_id": "c_part1"})
    generate(client, draft_id, {"structure": 4})
    data = generated(client, draft_id)["data"]
    assert (data["part_id"], data["order"], data["links"]["prev"], data["links"]["next"]) == (
        "c_part1",
        3,
        "c_e2",
        None,
    )
    assert data["links"]["causes"] == ["c_e1"]
    assert data["characters"] == ["c_teo"]
    assert data["locations"] == {"main": "c_port", "others": ["c_isle"]}
    assert data["foreshadowing"]["payoffs"] == ["fs_a"]
    assert data["foreshadowing"]["plants"][0]["id"] not in ("fs_1", "fs_a")
    prompt = llm.requests[-1].messages[-1]["content"]
    assert "카드 종류: episode. 단계 수: 4" in prompt
    for ref in ("c_main 메인 스토리", "c_part1 부", "c_port 지역", "c_isle 지역"):
        assert ref in prompt
    saved = save_draft(client, draft_id).json()
    assert (
        conn.execute(
            "SELECT from_id FROM episode_link WHERE to_id = ? AND kind = 'order'", (saved["id"],)
        ).fetchall()[0][0]
        == "c_e2"
    )
    # Regenerating an episode never moves it.
    llm.say("card", output("episode", value))
    draft_id = open_draft(
        client, {"type": "episode", "card_id": saved["id"]}, saved["source_notes"]
    )
    generate(client, draft_id)
    data = generated(client, draft_id)["data"]
    assert (data["part_id"], data["order"], data["links"]["prev"]) == ("c_part1", 3, "c_e2")


def test_pinned_fields_come_back(
    client: TestClient, conn: sqlite3.Connection, llm: Scripted
) -> None:
    save(conn, {**fixture("character"), "pinned": ["speech.examples"]})
    changed = fixture("character")
    changed["data"] = {
        **changed["data"],
        "speech": {
            "description": "새 말투",
            "examples": ["다른 대사 1", "다른 대사 2", "다른 대사 3"],
        },
        "theme": "새 주제",
    }
    llm.say("card", output("character", changed, name="새 이름"))
    draft_id = open_draft(client, {"type": "character", "card_id": "c_teo"})
    generate(client, draft_id)
    card = generated(client, draft_id)
    assert card["data"]["speech"]["examples"] == fixture("character")["data"]["speech"]["examples"]
    assert card["data"]["speech"]["description"] == "새 말투"
    # Pinning the new name keeps it over the next generation (from the card shown last).
    generate(client, draft_id, {"pinned": ["name", "theme"]})
    llm.say("card", output("character", fixture("character"), name="또 다른 이름"))
    generate(client, draft_id)
    card = generated(client, draft_id)
    assert (card["name"], card["data"]["theme"]) == ("새 이름", "새 주제")
    saved = save_draft(client, draft_id).json()
    assert saved["pinned"] == ["name", "theme"]


def test_save_refusals(client: TestClient, conn: sqlite3.Connection, llm: Scripted) -> None:
    draft_id = open_draft(client, {"type": "character"})
    assert error(save_draft(client, draft_id)) == (409, "NOTHING_TO_SAVE")
    generate(client, draft_id)
    client.put(f"/api/v1/drafts/{draft_id}/source", headers=AUTH, json={"notes": "바뀐 원문이다."})
    assert error(save_draft(client, draft_id)) == (409, "CARD_STALE")
    client.put(f"/api/v1/drafts/{draft_id}/source", headers=AUTH, json={"notes": NOTES})
    assert save_draft(client, draft_id).status_code == 200
    assert error(save_draft(client, draft_id)) == (404, "DRAFT_NOT_FOUND")

    # Editing a card deleted meanwhile, a second main story, a locked stage.
    save(conn, fixture("character", id="c_gone"))
    draft_id = open_draft(client, {"type": "character", "card_id": "c_gone"})
    generate(client, draft_id)
    client.delete("/api/v1/cards/c_gone", headers=AUTH)
    assert error(save_draft(client, draft_id)) == (404, "CARD_NOT_FOUND")
    save(conn, fixture("main-story", id="c_main"))
    llm.say("card", output("main_story", fixture("main-story")))
    draft_id = open_draft(client, {"type": "main_story"})
    generate(client, draft_id)
    assert error(save_draft(client, draft_id)) == (409, "CARD_CONFLICT")
    conn.execute("UPDATE work SET stage = 2, locked_stage = 1")
    assert error(save_draft(client, draft_id)) == (423, "STAGE_LOCKED")
    response = client.post(f"/api/v1/drafts/{draft_id}/generate", headers=AUTH, json={})
    assert error(response) == (423, "STAGE_LOCKED")


def test_llm_failure_fails_the_job(client: TestClient, llm: Scripted) -> None:
    llm.failures["card"] = LlmError("LLM_OUTPUT_TRUNCATED", "reply hit max_tokens")
    draft_id = open_draft(client, {"type": "character"})
    job = generate(client, draft_id)
    assert job["status"] == "failed"
    assert job["error"]["code"] == "LLM_OUTPUT_TRUNCATED"
    assert generated(client, draft_id) is None


def test_running_generation_is_reused() -> None:
    class Job:
        def __init__(self, status: str) -> None:
            self.id, self.status = "job_1", status

    class Jobs:
        def __init__(self, status: str) -> None:
            self.job = Job(status)

        def get(self, job_id: str) -> Job:
            return self.job

    class Draft:
        job_id = "job_1"

    assert draft_card.running(Jobs("running"), Draft()) == "job_1"  # type: ignore[arg-type]
    assert draft_card.running(Jobs("done"), Draft()) is None  # type: ignore[arg-type]
