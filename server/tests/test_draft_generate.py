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
from tests.test_cards import character, episodes_open, fixture, region, save, story
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

    # A sentence number copied in front of an unchanged text keeps its id too (and goes).
    answer["milestones"][1]["text"] = f"[3] {texts[1]}"
    llm.say("card", output("main_story", {"name": main["name"], "data": answer}))
    generate(client, draft_id)
    numbered = generated(client, draft_id)["data"]["milestones"]
    assert numbered[1] == {"id": first[1], "order": 2, "text": texts[1]}


def test_a_new_episode_goes_last_in_its_part(
    client: TestClient, conn: sqlite3.Connection, llm: Scripted
) -> None:
    episodes_open(conn)
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


def test_a_pinned_field_comes_back_under_an_undecided_parent() -> None:
    # No parent with pinnable sub-fields is nullable in today's schemas; set_path still
    # rebuilds one with only the pinned key filled if a schema ever makes it so.
    from aiplot.services.card_post import set_path

    data: dict[str, Any] = {"speech": None}
    shown = {"speech": {"description": "짧다", "examples": ["가자."]}}
    set_path(data, "speech.examples", ["가자."], shown)
    assert data == {"speech": {"description": None, "examples": ["가자."]}}
    untouched: dict[str, Any] = {"speech": None}
    set_path(untouched, "speech.examples", ["가자."], {"speech": None})
    assert untouched == {"speech": None}


def test_an_edited_world_card_keeps_its_related_worlds_whole(
    client: TestClient, conn: sqlite3.Connection, llm: Scripted
) -> None:
    for n in range(40):
        save(conn, fixture("world", id=f"c_w{n}", name=f"세계 {n}"))
    world = fixture("world", id="c_tide")
    world["data"] = {**world["data"], "related": ["c_w5"]}
    save(conn, world)
    llm.say("card", output("world", fixture("world")))
    draft_id = open_draft(client, {"type": "world", "card_id": "c_tide"})
    generate(client, draft_id)
    refs = llm.requests[-1].messages[-1]["content"].split("<참고 카드>\n")[1]
    assert "c_w5 세계관 세계 5: " in refs
    assert "c_w6 세계관 세계 6 (규칙·능력)" in refs


def test_new_parts_go_after_the_highest_order(
    client: TestClient, conn: sqlite3.Connection, llm: Scripted
) -> None:
    story(conn)
    third = fixture("part", id="c_part3")
    save(conn, {**third, "data": {**third["data"], "order": 3}})
    llm.say("card", output("part", fixture("part")))
    draft_id = open_draft(client, {"type": "part"})
    generate(client, draft_id)
    assert generated(client, draft_id)["data"]["order"] == 4


def test_items_with_the_same_text_keep_one_old_id_each() -> None:
    from aiplot.services.card_post import keep_ids

    before = [{"id": "ms_a", "text": "같다"}, {"id": "ms_b", "text": "같다"}]
    items = [
        {"id": "ms_1", "text": "같다"},
        {"id": "ms_2", "text": "같다"},
        {"id": "ms_3", "text": "같다"},
    ]
    keep_ids(items, before, "ms")
    assert [i["id"] for i in items[:2]] == ["ms_a", "ms_b"]
    assert items[2]["id"] not in ("ms_a", "ms_b", "ms_3")


def test_closing_a_draft_stops_its_generation() -> None:
    cancelled: list[str] = []

    class Job:
        id, status = "job_1", "running"

    class Jobs:
        def get(self, job_id: str) -> Job:
            return Job()

        def cancel(self, job: Job) -> bool:
            cancelled.append(job.id)
            return True

    class Draft:
        job_id = "job_1"

    draft_card.cancel(Jobs(), Draft())  # type: ignore[arg-type]
    assert cancelled == ["job_1"]


def test_a_linked_region_is_not_also_the_parent_and_sentence_numbers_go(
    client: TestClient, conn: sqlite3.Connection, llm: Scripted
) -> None:
    save(conn, region("c_city", "아르칸"))
    save(conn, region("c_isle", "섬"))
    value = fixture("region", name="루멘")
    link = {"target_id": "c_city", "travel": None, "direction": "서쪽"}
    value["data"] = {
        **value["data"],
        "parent_id": "c_city",
        "links": [link],
        "appearance": "[2] 붉은 지붕의 집들이 층층이 쌓여 있다.",
    }
    llm.say("card", output("region", value))
    draft_id = open_draft(client, {"type": "region"}, "루멘은 아르칸의 동쪽 항구다.")
    assert generate(client, draft_id)["status"] == "done"
    card = generated(client, draft_id)
    # Unit 15: the model put the neighbour it is linked to as its parent as well.
    assert card["data"]["parent_id"] is None
    assert card["data"]["links"] == [link]
    assert card["data"]["appearance"] == "붉은 지붕의 집들이 층층이 쌓여 있다."

    # A parent that is not a neighbour stays.
    value["data"] = {**value["data"], "parent_id": "c_isle"}
    llm.say("card", output("region", value))
    assert generate(client, draft_id)["status"] == "done"
    assert generated(client, draft_id)["data"]["parent_id"] == "c_isle"


def test_new_cards_are_placed_again_at_save(
    client: TestClient, conn: sqlite3.Connection, llm: Scripted
) -> None:
    """Two drafts generated side by side were both placed after the same last card; the one
    saved second must still go after the first, with no link dropped."""
    episodes_open(conn)
    save(conn, episode("c_e1", part_id="c_part1", order=1))
    llm.say("card", output("episode", episode("c_new")))
    first = open_draft(client, {"type": "episode", "part_id": "c_part1"})
    second = open_draft(client, {"type": "episode", "part_id": "c_part1"})
    for draft_id in (first, second):
        assert generate(client, draft_id)["status"] == "done"
        data = generated(client, draft_id)["data"]
        assert (data["order"], data["links"]["prev"]) == (2, "c_e1")
    a = save_draft(client, first).json()
    b = save_draft(client, second).json()
    assert (a["data"]["order"], a["data"]["links"]["prev"]) == (2, "c_e1")
    assert (b["data"]["order"], b["data"]["links"]["prev"]) == (3, a["id"])
    orders = conn.execute(
        'SELECT card_id, "order" FROM episode WHERE part_id = \'c_part1\' ORDER BY "order"'
    ).fetchall()
    assert [tuple(r) for r in orders] == [("c_e1", 1), (a["id"], 2), (b["id"], 3)]
    links = conn.execute("SELECT from_id, to_id FROM episode_link WHERE kind = 'order'")
    assert {tuple(r) for r in links} == {("c_e1", a["id"]), (a["id"], b["id"])}

    # Parts the same way: c_part1 and c_part2 hold orders 1 and 2.
    part = fixture("part")
    part["data"] = {**part["data"], "fulfills": []}
    llm.say("card", output("part", part))
    first = open_draft(client, {"type": "part"})
    second = open_draft(client, {"type": "part"})
    for draft_id in (first, second):
        assert generate(client, draft_id)["status"] == "done"
        assert generated(client, draft_id)["data"]["order"] == 3
    assert save_draft(client, first).json()["data"]["order"] == 3
    assert save_draft(client, second).json()["data"]["order"] == 4


def test_milestones_stay_with_their_one_part(
    client: TestClient, conn: sqlite3.Connection, llm: Scripted
) -> None:
    story(conn)  # main story ms_1, ms_2; part 1 fulfils ms_1
    # A new part cannot take ms_1 from part 1 (unit 15: the model listed other parts' too).
    value = fixture("part", name="2부", fulfills=None)
    value["data"] = {**value["data"], "title": "2부", "fulfills": ["ms_1", "ms_2"]}
    llm.say("card", output("part", value))
    draft_id = open_draft(client, {"type": "part"}, "2부에서 비밀이 드러난다.")
    assert generate(client, draft_id)["status"] == "done"
    assert generated(client, draft_id)["data"]["fulfills"] == ["ms_2"]
    # Saved, every milestone is in one part: the episode step opens.
    assert save_draft(client, draft_id).status_code == 200

    # An episode of part 1 fulfils only part 1's milestones.
    value = episode("c_new")
    value["data"] = {**value["data"], "fulfills": ["ms_1", "ms_2"]}
    llm.say("card", output("episode", value))
    draft_id = open_draft(client, {"type": "episode", "part_id": "c_part1"})
    assert generate(client, draft_id, {"structure": 4})["status"] == "done"
    assert generated(client, draft_id)["data"]["fulfills"] == ["ms_1"]


def test_an_edited_episode_keeps_where_it_stands_now_not_its_old_data(
    client: TestClient, conn: sqlite3.Connection, llm: Scripted
) -> None:
    """§6: placement comes from the episode and episode_link tables. A part delete that moves
    the episodes, or a reconnect around a deleted episode, does not rewrite the card's data."""
    from tests.test_card_delete import delete, world

    world(conn)  # c_e1 → c_e2 → c_e3 in part 1; part 2 empty
    assert delete(client, "c_e2", "?reconnect=true").status_code == 200
    assert delete(client, "c_part1", "?episodes=move:c_part2").status_code == 200
    moved = conn.execute('SELECT part_id, "order" FROM episode WHERE card_id = ?', ("c_e1",))
    part_id, order = moved.fetchone()
    assert part_id == "c_part2"

    # The model echoes the stale data (part 1, next = the deleted c_e2).
    value = episode("c_e1", links={"prev": None, "next": "c_e2", "causes": []})
    value["data"] = {**value["data"], "part_id": "c_part1", "order": 9}
    llm.say("card", output("episode", value))
    draft_id = open_draft(client, {"type": "episode", "card_id": "c_e1"})
    assert generate(client, draft_id, {"structure": 4})["status"] == "done"
    data = generated(client, draft_id)["data"]
    assert (data["part_id"], data["order"]) == ("c_part2", order)
    assert data["links"]["next"] == "c_e3"

    assert save_draft(client, draft_id).status_code == 200
    row = conn.execute('SELECT part_id, "order" FROM episode WHERE card_id = ?', ("c_e1",))
    assert tuple(row.fetchone()) == ("c_part2", order)
    links = conn.execute("SELECT from_id, to_id FROM episode_link WHERE kind = 'order'")
    assert ("c_e1", "c_e3") in {tuple(r) for r in links}
    # Its part's card is gone: the generation context names the part it is in now.
    prompt = llm.requests[-1].messages[-1]["content"]
    assert "c_part2" in prompt and "c_part1" not in prompt


def test_five_stages_map_onto_four_in_code() -> None:
    from aiplot.services.structure import five_to_four

    five: dict[str, Any] = {
        "type": 5,
        "stages": [
            {"name": "발단", "summary": "테오가 돌아온다.", "tension": 1},
            {"name": "전개", "summary": "흉터의 비밀이 드러난다.", "tension": 3},
            {"name": "위기", "summary": " 미라가 사라진다. ", "tension": 2},
            {"name": "절정", "summary": "탑에서 맞선다.", "tension": 5},
            {"name": "결말", "summary": None, "tension": None},
        ],
    }
    assert five_to_four(five) == {
        "type": 4,
        "stages": [
            {"name": "기", "summary": "테오가 돌아온다.", "tension": 1},
            {"name": "승", "summary": "흉터의 비밀이 드러난다. 미라가 사라진다.", "tension": 3},
            {"name": "전", "summary": "탑에서 맞선다.", "tension": 5},
            {"name": "결", "summary": None, "tension": None},
        ],
    }
    # 승 from one side only, or from neither.
    five["stages"][1] = {"name": "전개", "summary": None, "tension": None}
    joined = {"name": "승", "summary": "미라가 사라진다.", "tension": 2}
    assert five_to_four(five)["stages"][1] == joined
    five["stages"][2] = {"name": "위기", "summary": "", "tension": None}
    assert five_to_four(five)["stages"][1] == {"name": "승", "summary": None, "tension": None}


def test_a_generated_card_goes_from_five_stages_to_four_without_the_model(
    client: TestClient, conn: sqlite3.Connection, llm: Scripted
) -> None:
    episodes_open(conn)
    value = episode("c_new")
    llm.say("card", output("episode", value, evidence={"structure": [0], "theme": [1]}))
    draft_id = open_draft(client, {"type": "episode", "part_id": "c_part1"})
    assert generate(client, draft_id, {"structure": 5})["status"] == "done"
    before = generated(client, draft_id)
    calls = len(llm.requests)
    response = client.put(f"/api/v1/drafts/{draft_id}/structure", headers=AUTH, json={"type": 4})
    assert response.status_code == 200, response.json()
    after = response.json()["generated"]
    assert len(llm.requests) == calls
    assert after["data"]["structure"] == {
        "type": 4,
        "stages": [
            {"name": "기", "summary": "발단 요약", "tension": 1},
            {"name": "승", "summary": "전개 요약 위기 요약", "tension": 3},
            {"name": "전", "summary": "절정 요약", "tension": 5},
            {"name": "결", "summary": "결말 요약", "tension": 2},
        ],
    }
    # Nothing else changes: other fields, evidence, AI guesses.
    assert after["evidence"] == {"structure": [0], "theme": [1]}
    assert {**after, "data": {**after["data"], "structure": None}} == {
        **before,
        "data": {**before["data"], "structure": None},
    }
    assert generated(client, draft_id) == after
    # 저장 saves it as shown.
    saved = save_draft(client, draft_id).json()
    assert saved["data"]["structure"] == after["data"]["structure"]


def test_structure_stages_are_named_by_position(
    client: TestClient, conn: sqlite3.Connection, llm: Scripted
) -> None:
    """§15: exactly 기승전결 or 발단…결말. The model may repeat a stage name; stages are in story
    order, so each one takes its position's name and keeps its summary and tension."""
    episodes_open(conn)
    value = episode("c_new")
    stages = value["data"]["structure"]["stages"]
    value["data"]["structure"]["stages"] = [
        {**stage, "name": name}
        for stage, name in zip(stages, ["발단", "발단", "위기", "절정", "결말"], strict=True)
    ]
    llm.say("card", output("episode", value))
    draft_id = open_draft(client, {"type": "episode", "part_id": "c_part1"})
    assert generate(client, draft_id)["status"] == "done"
    named = generated(client, draft_id)["data"]["structure"]
    assert named["stages"] == [
        {**stage, "name": name}
        for stage, name in zip(stages, ["발단", "전개", "위기", "절정", "결말"], strict=True)
    ]
    # 5→4 then keeps every stage (it maps by name).
    response = client.put(f"/api/v1/drafts/{draft_id}/structure", headers=AUTH, json={"type": 4})
    four = response.json()["generated"]["data"]["structure"]["stages"]
    assert [stage["summary"] for stage in four] == [
        "발단 요약",
        "전개 요약 위기 요약",
        "절정 요약",
        "결말 요약",
    ]

    four_value = episode("c_new")
    four_value["data"]["structure"] = {
        "type": 4,
        "stages": [
            {"name": name, "summary": f"{i} 요약", "tension": 2}
            for i, name in enumerate(["기", "기", "결", "결"])
        ],
    }
    llm.say("card", output("episode", four_value))
    draft_id = open_draft(client, {"type": "episode", "part_id": "c_part1"})
    assert generate(client, draft_id)["status"] == "done"
    named = generated(client, draft_id)["data"]["structure"]
    assert [(s["name"], s["summary"]) for s in named["stages"]] == [
        ("기", "0 요약"),
        ("승", "1 요약"),
        ("전", "2 요약"),
        ("결", "3 요약"),
    ]


def test_structure_change_refusals(
    client: TestClient, conn: sqlite3.Connection, llm: Scripted
) -> None:
    def put(draft_id: str, body: dict[str, Any]) -> Any:
        return client.put(f"/api/v1/drafts/{draft_id}/structure", headers=AUTH, json=body)

    assert error(put("dr_ghost", {"type": 4})) == (404, "DRAFT_NOT_FOUND")
    episodes_open(conn)
    draft_id = open_draft(client, {"type": "episode", "part_id": "c_part1"})
    assert error(put(draft_id, {"type": 4})) == (409, "NOTHING_TO_CONVERT")
    # 4→5 is the AI's split of 승, not built yet.
    assert error(put(draft_id, {"type": 5})) == (422, "VALIDATION_ERROR")
    llm.say("card", output("episode", episode("c_new")))
    assert generate(client, draft_id)["status"] == "done"
    assert put(draft_id, {"type": 4}).status_code == 200
    # Already four stages.
    assert error(put(draft_id, {"type": 4})) == (409, "STRUCTURE_NOT_FIVE")
    # A card type without a structure.
    llm.say("card", output("character", fixture("character")))
    draft_id = open_draft(client, {"type": "character"})
    assert generate(client, draft_id)["status"] == "done"
    assert error(put(draft_id, {"type": 4})) == (409, "STRUCTURE_NOT_FIVE")
    # An undecided structure.
    llm.say("card", output("episode", episode("c_new", structure=None)))
    draft_id = open_draft(client, {"type": "episode", "part_id": "c_part1"})
    assert generate(client, draft_id)["status"] == "done"
    assert error(put(draft_id, {"type": 4})) == (409, "STRUCTURE_NOT_FIVE")
    conn.execute("UPDATE work SET stage = 2, locked_stage = 1")
    assert error(put(draft_id, {"type": 4})) == (423, "STAGE_LOCKED")
