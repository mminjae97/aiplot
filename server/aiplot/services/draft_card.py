"""카드 생성 and 저장 in the drawer (§8, §13).

Generation runs as a job (it has no time limit, §20): the card role reads the numbered notes,
the cards it may point at and the type, and its output is cleaned by card_post. Saving writes
the notes, the card and its relations in one transaction and closes the draft.
"""

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from aiplot.db import cards as cards_db
from aiplot.db.connection import connect
from aiplot.generated.card.card import Card
from aiplot.generated.roles.card_output import (
    CardOutput,
    CharacterCardOutput,
    EpisodeCardOutput,
    MainStoryCardOutput,
    PartCardOutput,
    RegionCardOutput,
    WorldCardOutput,
)
from aiplot.jobs.queue import TERMINAL, JobContext, JobError, JobQueue
from aiplot.llm.client import LlmError, Message
from aiplot.llm.router import Router
from aiplot.services import card_post, cards
from aiplot.services import draft_context as context
from aiplot.services.drafts import DraftState, DraftStore
from aiplot.services.notes import numbered, split_sentences
from aiplot.services.works import require_open

OUTPUTS: dict[str, type[BaseModel]] = {
    "world": WorldCardOutput,
    "character": CharacterCardOutput,
    "region": RegionCardOutput,
    "main_story": MainStoryCardOutput,
    "part": PartCardOutput,
    "episode": EpisodeCardOutput,
}

# World cards go in with summaries while they fit about this many characters (~800 tokens,
# §8; to be measured in unit 15), else as names and categories only.
WORLD_CHARS = 1200


class NothingToSaveError(ValueError):
    """저장 before any 카드 생성."""


class CardStaleError(ValueError):
    """The notes changed after the card was generated: its evidence would point elsewhere."""


@dataclass(frozen=True)
class Generation:
    draft: DraftState
    notes: str
    turns: list[Message]
    pinned: list[str]
    saved: dict[str, Any] | None
    shown: dict[str, Any] | None


def world_line(row: cards_db.CardRow, full: bool) -> str:
    if full:
        return context.ref_lines_of([row])
    category = context.CATEGORY.get(row.data.get("category") or "", "기타")
    return f"{row.id} 세계관 {row.name or '(이름 없음)'} ({category})"


def related_worlds(conn: sqlite3.Connection, card_id: str | None) -> set[str]:
    """World cards the saved card is tied to: shown in full even when the list is long."""
    if card_id is None:
        return set()
    tied = {ref for ref, field in cards_db.references(conn, card_id) if field == "related"}
    row = cards_db.get(conn, card_id)
    if row is not None and row.type == "episode":
        tied |= set(row.data.get("world") or [])
    return tied


def card_refs(conn: sqlite3.Connection, draft: DraftState) -> str:
    """@ cards, the earlier stage's cards and the work's world cards (§8 generation inputs)."""
    rows = context.mentioned(conn, draft.work_id, draft.refs)
    if draft.type in ("part", "episode"):
        main = cards_db.main_story_of(conn, draft.work_id)
        rows += context.mentioned(conn, draft.work_id, [main] if main else [])
    if draft.type == "episode":
        part = draft.part_id
        if draft.saved is not None:
            part = getattr(draft.saved.data, "part_id", None)
        rows += context.mentioned(conn, draft.work_id, [part] if part else [])
        rows += cards_db.list_for_work(conn, draft.work_id, "region")
    seen: set[str] = set()
    picked = []
    for row in rows:
        if row.id not in seen and row.id != draft.card_id:
            seen.add(row.id)
            picked.append(row)
    lines = [context.ref_lines(conn, picked)] if picked else []
    worlds = [
        w
        for w in cards_db.list_for_work(conn, draft.work_id, "world")
        if w.id not in seen and w.id != draft.card_id
    ]
    full = "\n".join(world_line(w, True) for w in worlds)
    if len(full) <= WORLD_CHARS:
        lines += [full] if full else []
    else:
        tied = related_worlds(conn, draft.card_id)
        lines += [world_line(w, w.id in tied) for w in worlds]
    return "\n".join(lines)


def card_turns(
    notes: str, refs: str, card_type: str, category: str | None, structure: int | None
) -> list[Message]:
    order = f"카드 종류: {card_type}"
    if category is not None:
        order += f". 분류: {category}"
    if structure is not None:
        order += f". 단계 수: {structure}"
    return [
        {
            "role": "user",
            "content": "\n".join(
                [
                    context.block("원문", numbered(notes)),
                    context.block("참고 카드", refs),
                    context.block("지시", order),
                ]
            ),
        }
    ]


def prepare(
    conn: sqlite3.Connection,
    draft: DraftState,
    pinned: list[str] | None,
    structure: int | None,
) -> Generation:
    require_open(conn, draft.work_id, 1)
    with draft.lock:
        if pinned is not None:
            draft.pinned = list(dict.fromkeys(pinned))
        notes = draft.notes
        kept = list(draft.pinned)
        generated = draft.generated
    saved = draft.saved.model_dump(mode="json") if draft.saved is not None else None
    shown = generated.model_dump(mode="json") if generated is not None else saved
    turns = card_turns(notes, card_refs(conn, draft), draft.type, draft.category, structure)
    return Generation(draft, notes, turns, kept, saved, shown)


def running(jobs: JobQueue, draft: DraftState) -> str | None:
    job = jobs.get(draft.job_id) if draft.job_id else None
    return job.id if job is not None and job.status not in TERMINAL else None


def start(router: Router, jobs: JobQueue, db_path: Path, generation: Generation) -> str:
    """Submits the generation; a draft already generating answers with that job."""
    draft = generation.draft
    with draft.lock:
        current = running(jobs, draft)
        if current is not None:
            return current

        async def run(ctx: JobContext) -> dict[str, Any]:
            ctx.progress(0, 1, "card")
            try:
                result = await router.complete_json("card", generation.turns, OUTPUTS[draft.type])
            except LlmError as exc:
                raise JobError(exc.code, str(exc)) from exc
            output = card_post.OUTPUT.validate_python(result.value.model_dump(mode="json"))
            conn = connect(db_path)
            try:
                cleaned = card_post.process(
                    conn,
                    output,
                    work_id=draft.work_id,
                    card_id=draft.card_id,
                    part_id=draft.part_id,
                    sentences=len(split_sentences(generation.notes)),
                    saved=generation.saved,
                    shown=generation.shown,
                    pinned=generation.pinned,
                )
            finally:
                conn.close()
            with draft.lock:
                draft.generated = cleaned
                draft.generated_notes = generation.notes
            ctx.progress(1, 1, "card")
            return {"card": cleaned.model_dump(mode="json")}

        job = jobs.submit("card", run, work_id=draft.work_id)
        draft.job_id = job.id
        return job.id


def save(conn: sqlite3.Connection, store: DraftStore, draft_id: str) -> Card:
    """Notes + card + relation rows in one transaction (cards.save); the drawer then closes."""
    draft = store.get(draft_id)
    with draft.lock:
        generated: CardOutput | None = draft.generated
        if generated is None:
            raise NothingToSaveError("generate the card first")
        if draft.generated_notes != draft.notes:
            raise CardStaleError("the notes changed after the card was generated")
        notes = draft.notes
        pinned = list(draft.pinned)
    if draft.card_id is not None and cards_db.get(conn, draft.card_id) is None:
        raise cards.CardNotFoundError(draft.card_id)
    value = {
        **generated.model_dump(mode="json"),
        "id": draft.card_id or cards.new_card_id(),
        "work_id": draft.work_id,
        "status": "incomplete",
        "source_notes": notes,
        "pinned": pinned,
        "schema_version": cards.SCHEMA_VERSION,
    }
    if draft.type == "region":
        value["position"] = None
    saved = cards.save(conn, cards.CARD.validate_python(value))
    store.remove(draft_id)
    return saved
