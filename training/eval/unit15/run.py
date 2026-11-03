"""Step 1 unit 15: card generation, name checks and chat latency on the real model (§20).

Start llama-server by hand with the base profile's GGUF and flags (§17), then:
    uv run python eval/unit15/run.py --url http://127.0.0.1:8796 \
        --out eval/results/unit15/run.json

Every case runs through the app's own code, on a throwaway database holding the case's seed
cards: card generation is draft_card.prepare → the card role (router, one JSON retry) →
card_post.process, exactly as a 카드 생성 job; a name check is one drawer turn
(draft_chat.prepare → events: chat, then source with its similar names). Roles keep their
configured settings (config/roles.yaml). Results hold raw model output and stay out of git.
"""

import argparse
import asyncio
import copy
import json
import tempfile
import time
from collections.abc import AsyncGenerator
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from aiplot.db.connection import connect
from aiplot.db.migrate import init_db
from aiplot.generated.drafts.draft_create import DraftCreate
from aiplot.generated.drafts.message_events import (
    DraftErrorEvent,
    DraftReplyEvent,
    DraftSourceEvent,
)
from aiplot.llm.client import ChatRequest, Delta, LlamaClient, LlmError
from aiplot.llm.config import load_llm_config
from aiplot.llm.router import Router
from aiplot.services import card_post, cards, draft_card, draft_chat, drafts, works
from aiplot.services.notes import split_sentences

HERE = Path(__file__).parent
GENRES = ["fantasy", "hunter", "romance", "wuxia", "mystery", "scifi"]

# Every data key present (§15): seeds give only what they need.
BLANK: dict[str, dict[str, Any]] = {
    "world": {
        "category": "other",
        "summary": None,
        "details": None,
        "rules": [],
        "terms": [],
        "related": [],
    },
    "character": {
        "theme": None,
        "personality": {"traits": [], "behaviors": []},
        "speech": {"description": None, "examples": []},
        "appearance": {"summary": None, "details": None},
        "relations": [],
        "origin_region_id": None,
    },
    "region": {
        "parent_id": None,
        "links": [],
        "appearance": None,
        "environment": {"natural": None, "social": None},
        "sensory": {"smell": None, "sound": None, "mood": None},
    },
    "main_story": {"theme": None, "premise": None, "ending": None, "milestones": []},
    "part": {
        "order": None,
        "title": None,
        "theme": None,
        "fulfills": [],
        "start": None,
        "end": None,
        "structure": None,
    },
    "episode": {
        "part_id": None,
        "order": None,
        "theme": None,
        "relation_to_main": None,
        "fulfills": [],
        "characters": [],
        "locations": {"main": None, "others": []},
        "world": [],
        "links": {"prev": None, "next": None, "causes": []},
        "foreshadowing": {"plants": [], "payoffs": []},
        "worldline_id": None,
        "structure": None,
        "synopsis": None,
    },
}


def merged(base: dict[str, Any], extra: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(base)
    for key, value in extra.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = merged(out[key], value)
        else:
            out[key] = value
    return out


class CountingClient:
    """The real client, counting attempts per role (a second card attempt = the JSON retry)."""

    def __init__(self, client: LlamaClient) -> None:
        self.client = client
        self.attempts: list[str] = []

    def stream(self, request: ChatRequest) -> AsyncGenerator[Delta, None]:
        self.attempts.append(request.role)
        return self.client.stream(request)


def open_work(folder: Path, seeds: list[dict[str, Any]]) -> tuple[Any, str]:
    db = folder / "aiplot.db"
    init_db(db)
    conn = connect(db)
    work = works.create(conn, "평가")
    # Saved in dependency order: regions and parts may point at earlier cards.
    order = ["main_story", "world", "region", "character", "part", "episode"]
    for card_type in order:
        for seed in (s for s in seeds if s["type"] == card_type):
            card = cards.CARD.validate_python(
                {
                    "id": seed["id"],
                    "work_id": work.id,
                    "type": seed["type"],
                    "name": seed["name"],
                    "status": "incomplete",
                    "source_notes": "",
                    "data": merged(BLANK[seed["type"]], seed["data"]),
                    "evidence": {},
                    "ai_guess": [],
                    "pinned": [],
                    "schema_version": 1,
                    **({"position": None} if seed["type"] == "region" else {}),
                }
            )
            cards.save(conn, card)
    return conn, work.id


async def run_card(
    router: Router, counter: CountingClient, case: dict[str, Any], seeds: list[dict[str, Any]]
) -> dict[str, Any]:
    picked = [s for s in seeds if s["id"] in case["seeds"]]
    with tempfile.TemporaryDirectory() as tmp:
        conn, work_id = open_work(Path(tmp), picked)
        try:
            store = drafts.DraftStore()
            view = drafts.create(
                conn,
                store,
                work_id,
                DraftCreate(type=case["type"], category=case["category"], part_id=case["part_id"]),
            )
            draft = store.get(view.id)
            draft.notes = case["notes"]
            draft.refs = list(case["refs"])
            generation = draft_card.prepare(conn, draft, None, case["structure"])
            before = len(counter.attempts)
            started = time.perf_counter()
            try:
                result = await router.complete_json(
                    "card", generation.turns, draft_card.OUTPUTS[case["type"]]
                )
            except LlmError as exc:
                return {
                    "id": case["id"],
                    "error": exc.code,
                    "message": str(exc)[:500],
                    "attempts": len(counter.attempts) - before,
                    "total_s": round(time.perf_counter() - started, 1),
                }
            output = card_post.OUTPUT.validate_python(result.value.model_dump(mode="json"))
            cleaned = card_post.process(
                conn,
                output,
                work_id=work_id,
                card_id=None,
                part_id=case["part_id"],
                sentences=len(split_sentences(case["notes"])),
                saved=None,
                shown=None,
                pinned=[],
            )
            return {
                "id": case["id"],
                "card": cleaned.model_dump(mode="json"),
                "attempts": len(counter.attempts) - before,
                "total_s": round(time.perf_counter() - started, 1),
                "usage": asdict(result.usage) if result.usage is not None else None,
                "prompt": generation.turns[0]["content"],
            }
        finally:
            conn.close()


async def run_name(
    router: Router, case: dict[str, Any], seeds: list[dict[str, Any]]
) -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as tmp:
        conn, work_id = open_work(Path(tmp), seeds)
        try:
            store = drafts.DraftStore()
            view = drafts.create(conn, store, work_id, DraftCreate(type=case["type"]))
            turn = draft_chat.prepare(conn, store.get(view.id), case["text"], [])
        finally:
            conn.close()
    started = time.perf_counter()
    first: float | None = None
    reply: list[str] = []
    source: dict[str, Any] | None = None
    error: dict[str, str] | None = None
    async for name, event in draft_chat.events(router, turn):
        if isinstance(event, DraftReplyEvent):
            first = first or time.perf_counter() - started
            reply.append(event.text)
        elif isinstance(event, DraftSourceEvent):
            source = event.model_dump(mode="json")
        elif isinstance(event, DraftErrorEvent):
            error = {"code": event.code, "message": event.message}
        del name
    return {
        "id": case["id"],
        "first_char_s": round(first, 2) if first is not None else None,
        "total_s": round(time.perf_counter() - started, 1),
        "reply": "".join(reply),
        "similar_names": (source or {}).get("similar_names"),
        "notes": (source or {}).get("notes"),
        "error": error,
    }


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--cases", nargs="+", metavar="ID", help="only these case ids")
    parser.add_argument("--skip-names", action="store_true")
    args = parser.parse_args()

    genres = {
        g: json.loads((HERE / "cases" / f"{g}.json").read_text(encoding="utf-8")) for g in GENRES
    }
    counter = CountingClient(LlamaClient(args.url))
    router = Router(load_llm_config(), counter, lora_dir=HERE / "no-lora")
    results: dict[str, Any] = {
        "started_at": datetime.now(UTC).isoformat(),
        "cards": [],
        "names": [],
    }
    for genre, data in genres.items():
        for case in data["cases"]:
            if args.cases and case["id"] not in args.cases:
                continue
            print(f"card {case['id']}", flush=True)
            results["cards"].append(
                {"genre": genre, **await run_card(router, counter, case, data["seeds"])}
            )
        if args.skip_names:
            continue
        for case in data["names"]:
            if args.cases and case["id"] not in args.cases:
                continue
            print(f"name {case['id']}", flush=True)
            results["names"].append({"genre": genre, **await run_name(router, case, data["seeds"])})
    await counter.client.aclose()
    results["finished_at"] = datetime.now(UTC).isoformat()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    asyncio.run(main())
