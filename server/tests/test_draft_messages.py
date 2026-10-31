"""Drawer turns over SSE (§8, §13): chat streams, source folds the turn into the notes."""

import json
import sqlite3
from collections.abc import AsyncGenerator, Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from aiplot.db.connection import connect
from aiplot.db.migrate import init_db
from aiplot.llm.client import ChatRequest, Delta, LlmError
from aiplot.llm.config import load_llm_config
from aiplot.llm.fake import FakeClient, FakeResponse
from aiplot.llm.router import Router
from aiplot.llm.runtime import LlmRuntime, fake_runtime
from aiplot.main import create_app
from aiplot.services import draft_context
from aiplot.services.drafts import DraftStore
from tests.test_cards import character, fixture, save

TOKEN = "test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
NOTES = "테오는 북부 항구 출신이다. 말수가 적다."
REPLY = "활을 쓰는 테오군요. 어디서 배웠나요?"


def source(edits: list[Any] | None = None, added: list[str] | None = None, **rest: Any) -> str:
    return json.dumps(
        {
            "edits": edits or [],
            "added": added or [],
            "questions": rest.get("questions", []),
            "similar_names": rest.get("similar_names", []),
        },
        ensure_ascii=False,
    )


class Scripted(FakeClient):
    """Replies per role in order (the last one repeats); hooks run before a role answers."""

    def __init__(self) -> None:
        super().__init__({})
        self.script: dict[str, list[FakeResponse]] = {}
        self.hooks: dict[str, Callable[[], None]] = {}
        self.failures: dict[str, LlmError] = {}

    def say(self, role: str, *contents: str) -> None:
        self.script[role] = [FakeResponse(content=c) for c in contents]

    async def stream(self, request: ChatRequest) -> AsyncGenerator[Delta, None]:
        if request.role in self.hooks:
            self.hooks[request.role]()
        if request.role in self.failures:
            raise self.failures[request.role]
        queue = self.script[request.role]
        self.responses[request.role] = queue.pop(0) if len(queue) > 1 else queue[0]
        async for delta in super().stream(request):
            yield delta


@pytest.fixture
def llm() -> Scripted:
    client = Scripted()
    client.say("chat", REPLY)
    client.say("source", source(added=["테오는 활을 쓴다."], questions=["몇 살인가요?"]))
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
def client(tmp_path: Path, conn: sqlite3.Connection, llm: Scripted) -> TestClient:
    base = fake_runtime(tmp_path)
    runtime = LlmRuntime(Router(load_llm_config(), llm, lora_dir=tmp_path / "lora"), base.setup)
    return TestClient(create_app(token=TOKEN, db_path=tmp_path / "data" / "aiplot.db", llm=runtime))


def drafts_of(client: TestClient) -> DraftStore:
    store: DraftStore = client.app.state.drafts  # type: ignore[attr-defined]
    return store


def open_draft(client: TestClient, body: dict[str, Any], notes: str | None = None) -> str:
    response = client.post("/api/v1/works/w_01/drafts", headers=AUTH, json=body)
    assert response.status_code == 201, response.json()
    draft_id: str = response.json()["id"]
    if notes is not None:
        client.put(f"/api/v1/drafts/{draft_id}/source", headers=AUTH, json={"notes": notes})
    return draft_id


def turn(client: TestClient, draft_id: str, text: str, refs: list[str] | None = None) -> Any:
    body: dict[str, Any] = {"text": text}
    if refs is not None:
        body["refs"] = refs
    return client.post(f"/api/v1/drafts/{draft_id}/messages", headers=AUTH, json=body)


def events(response: Any) -> list[tuple[str, Any]]:
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    found = []
    for chunk in response.text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in chunk.split("\n"))
        found.append((lines["event"], json.loads(lines["data"])))
    return found


def draft(client: TestClient, draft_id: str) -> Any:
    return client.get(f"/api/v1/drafts/{draft_id}", headers=AUTH).json()


def error(response: Any) -> tuple[int, str]:
    return response.status_code, response.json()["code"]


def test_the_ai_opens_a_new_card(client: TestClient, llm: Scripted) -> None:
    draft_id = open_draft(client, {"type": "character"})
    found = events(turn(client, draft_id, ""))
    assert [name for name, _ in found] == ["reply"] * len(found[:-1]) + ["done"]
    assert "".join(data["text"] for name, data in found if name == "reply") == REPLY
    assert draft(client, draft_id)["turns"] == [{"role": "ai", "text": REPLY}]
    # No user words yet: nothing to fold into the notes.
    assert [r.role for r in llm.requests] == ["chat"]
    prompt = llm.requests[0].messages[-1]["content"]
    assert "<지시>\n카드 종류: 캐릭터. 정해지지 않은 항목: 이름, 주제, 성격 특성" in prompt
    assert error(turn(client, draft_id, "  ")) == (422, "MESSAGE_EMPTY")


def test_a_turn_updates_the_notes(
    client: TestClient, conn: sqlite3.Connection, llm: Scripted
) -> None:
    save(conn, character("c_mira", "미라", relations=[]))
    draft_id = open_draft(client, {"type": "character"}, NOTES)
    found = events(turn(client, draft_id, "테오는 활을 써."))
    names = [name for name, _ in found]
    assert names[-2:] == ["source", "done"] and set(names[:-2]) == {"reply"}
    update = found[-2][1]
    assert update["notes"] == f"{NOTES}\n테오는 활을 쓴다."
    assert update["sentences"][-1] == "테오는 활을 쓴다."
    assert update["changed"] == [2]
    assert update["questions"] == ["몇 살인가요?"]
    state = draft(client, draft_id)
    assert state["notes"] == update["notes"]
    assert state["turns"] == [
        {"role": "user", "text": "테오는 활을 써."},
        {"role": "ai", "text": REPLY},
    ]
    chat, source_request = llm.requests
    assert chat.messages[-1]["content"].startswith(f"<원문>\n{NOTES}\n</원문>")
    assert chat.messages[-1]["content"].endswith("\n\n테오는 활을 써.")
    prompt = source_request.messages[-1]["content"]
    assert "[0] 테오는 북부 항구 출신이다.\n[1] 말수가 적다." in prompt
    assert "<참고 카드>\nc_mira 캐릭터 미라\n</참고 카드>" in prompt
    assert f"<대화>\n사용자: 테오는 활을 써.\nAI: {REPLY}\n</대화>" in prompt


def test_the_last_turns_follow_the_context(client: TestClient, llm: Scripted) -> None:
    draft_id = open_draft(client, {"type": "character"}, NOTES)
    for text in ("하나.", "둘.", "셋.", "넷."):
        events(turn(client, draft_id, text))
    messages = llm.requests[-2].messages
    # System, the context, then the last 6 turns (the new one included), kept whole even when
    # the window starts with the AI.
    assert [m["role"] for m in messages] == ["system", "user"] + ["assistant", "user"] * 3
    assert messages[1]["content"].startswith("<원문>")
    assert messages[1]["content"].endswith("</지시>")
    assert messages[3]["content"] == "둘."
    assert messages[-1]["content"] == "넷."


def test_the_answer_to_the_opening_keeps_its_question(client: TestClient, llm: Scripted) -> None:
    draft_id = open_draft(client, {"type": "character"})
    events(turn(client, draft_id, ""))
    events(turn(client, draft_id, "열일곱 살이야."))
    messages = llm.requests[-2].messages
    assert [m["role"] for m in messages] == ["system", "user", "assistant", "user"]
    assert messages[1]["content"].startswith("<원문>") and messages[1]["content"].endswith(
        "</지시>"
    )
    assert messages[2]["content"] == REPLY
    assert messages[3]["content"] == "열일곱 살이야."


def test_casual_or_emptied_notes_get_one_more_try(client: TestClient, llm: Scripted) -> None:
    draft_id = open_draft(client, {"type": "character"}, NOTES)
    llm.say("source", source(added=["테오는 활을 써"]), source(added=["테오는 활을 쓴다."]))
    update = events(turn(client, draft_id, "활을 써."))[-2][1]
    assert update["notes"].endswith("테오는 활을 쓴다.")
    # Casual twice: the second is kept (§13).
    llm.say("source", source(added=["칼도 써"]), source(added=["창도 써"]))
    update = events(turn(client, draft_id, "칼도 써."))[-2][1]
    assert update["notes"].endswith("창도 써.")
    # Emptied twice: the notes stay and the turn says why.
    before = draft(client, draft_id)["notes"]
    wipe = source(edits=[{"index": i, "text": None} for i in range(5)])
    llm.say("source", wipe, wipe)
    found = events(turn(client, draft_id, "다 지워."))
    assert found[-2:] == [
        ("error", {"code": "LLM_INVALID_OUTPUT", "message": "source emptied the notes twice"}),
        ("done", {}),
    ]
    assert draft(client, draft_id)["notes"] == before


def test_a_casual_result_stands_when_the_extra_try_fails(client: TestClient, llm: Scripted) -> None:
    draft_id = open_draft(client, {"type": "character"}, NOTES)
    llm.say("source", source(added=["테오는 활을 써"]), "not json")
    found = events(turn(client, draft_id, "활을 써."))
    assert found[-2][0] == "source"
    assert found[-2][1]["notes"].endswith("테오는 활을 써.")


def test_similar_names_keep_only_real_pairs(
    client: TestClient, conn: sqlite3.Connection, llm: Scripted
) -> None:
    save(conn, character("c_leo", "레오", relations=[]))
    save(conn, character("c_teo", "테오", relations=[]))
    draft_id = open_draft(client, {"type": "character", "card_id": "c_teo"})
    pairs = [
        {"mentioned": "래오", "similar_to": "레오", "card_id": "c_leo"},
        {"mentioned": "티오", "similar_to": "테오", "card_id": None},
        {"mentioned": "레오", "similar_to": "레오", "card_id": "c_leo"},
        {"mentioned": "레오", "similar_to": "리오", "card_id": "c_ghost"},
        {"mentioned": "테오", "similar_to": "태오", "card_id": "c_teo"},
    ]
    llm.say("source", source(added=["래오는 친구다."], similar_names=pairs))
    update = events(turn(client, draft_id, "래오는 친구야."))[-2][1]
    assert update["similar_names"] == pairs[:2]
    # The card being edited is not offered as its own look-alike.
    prompt = llm.requests[-1].messages[-1]["content"]
    assert "c_leo 캐릭터 레오" in prompt and "c_teo" not in prompt


def test_mentioned_cards_join_the_context(
    client: TestClient, conn: sqlite3.Connection, llm: Scripted
) -> None:
    save(conn, fixture("main-story", id="c_main"))
    save(conn, character("c_mira", "미라", relations=[]))
    draft_id = open_draft(client, {"type": "part"}, "1부는 귀환이다.")
    events(turn(client, draft_id, "@미라 가 나와.", refs=["c_mira", "c_main", "c_ghost"]))
    events(turn(client, draft_id, "다음."))
    prompt = llm.requests[-2].messages[1]["content"]
    refs = prompt.split("<참고 카드>\n")[1].split("\n</참고 카드>")[0]
    milestone = conn.execute('SELECT id, text FROM milestone ORDER BY "order"').fetchone()
    assert refs.startswith("c_mira 캐릭터 미라: ")
    assert f"\n  - {milestone[0]}: {milestone[1]}" in refs
    assert "c_ghost" not in refs


def test_llm_errors_end_the_turn(client: TestClient, llm: Scripted) -> None:
    draft_id = open_draft(client, {"type": "character"}, NOTES)
    llm.failures["chat"] = LlmError("LLM_UNAVAILABLE", "llama-server is not ready")
    assert events(turn(client, draft_id, "안녕.")) == [
        ("error", {"code": "LLM_UNAVAILABLE", "message": "llama-server is not ready"}),
        ("done", {}),
    ]
    assert draft(client, draft_id)["turns"] == []
    del llm.failures["chat"]
    llm.failures["source"] = LlmError("LLM_REQUEST_FAILED", "HTTP 500")
    found = events(turn(client, draft_id, "안녕."))
    assert found[-2][0] == "error" and found[-2][1]["code"] == "LLM_REQUEST_FAILED"
    # The reply stays in the conversation; the notes are as they were.
    assert len(draft(client, draft_id)["turns"]) == 2
    assert draft(client, draft_id)["notes"] == NOTES


def test_notes_edited_meanwhile_win(client: TestClient, llm: Scripted) -> None:
    draft_id = open_draft(client, {"type": "character"}, NOTES)

    def edit_now() -> None:
        state = drafts_of(client).get(draft_id)
        with state.lock:
            state.notes = "작가가 고친 원문이다."

    llm.hooks["source"] = edit_now
    found = events(turn(client, draft_id, "활을 써."))
    assert found[-2][1]["code"] == "NOTES_CHANGED"
    assert draft(client, draft_id)["notes"] == "작가가 고친 원문이다."


def test_one_turn_at_a_time_and_refusals(client: TestClient, conn: sqlite3.Connection) -> None:
    draft_id = open_draft(client, {"type": "character"}, NOTES)
    drafts_of(client).get(draft_id).busy = True
    assert error(turn(client, draft_id, "안녕.")) == (409, "DRAFT_BUSY")
    drafts_of(client).get(draft_id).busy = False
    # Accepted turns never mark the draft before the stream starts.
    from aiplot.services import draft_chat

    with connect(Path(client.app.state.db_path)) as other:  # type: ignore[attr-defined]
        draft_chat.prepare(other, drafts_of(client).get(draft_id), "안녕.", [])
    assert drafts_of(client).get(draft_id).busy is False
    assert error(turn(client, "dr_nope", "안녕.")) == (404, "DRAFT_NOT_FOUND")
    conn.execute("UPDATE work SET stage = 2, locked_stage = 1")
    assert error(turn(client, draft_id, "안녕.")) == (423, "STAGE_LOCKED")
    # A refused turn leaves the draft free.
    assert drafts_of(client).get(draft_id).busy is False
    assert client.post(f"/api/v1/drafts/{draft_id}/messages", json={"text": "x"}).status_code == 401


def test_missing_items_follow_the_generated_card() -> None:
    assert draft_context.missing("world", None) == ["이름", "요약"]
    from aiplot.services.cards import CARD

    value = fixture("character")
    card = CARD.validate_python(value)
    output: Any = {
        "type": "character",
        "name": card.name,
        "data": value["data"],
        "evidence": {},
        "ai_guess": [],
    }
    from pydantic import TypeAdapter

    from aiplot.generated.roles.card_output import CardOutput

    generated = TypeAdapter(CardOutput).validate_python(output)
    assert draft_context.missing("character", generated) == []
    output["data"] = {**value["data"], "speech": {"description": "짧다", "examples": ["a"]}}
    generated = TypeAdapter(CardOutput).validate_python(output)
    assert draft_context.missing("character", generated) == ["대사 예시 3~5개"]
