"""One drawer turn (§8, §13): chat answers as it streams, then source folds the turn into the
notes sentence by sentence; questions and similar names come along.

The database is read before the stream starts (Turn); the stream itself only calls the LLM
and updates the draft in memory.
"""

import asyncio
import sqlite3
from collections.abc import AsyncIterator
from dataclasses import dataclass

from pydantic import BaseModel

from aiplot.db import cards as cards_db
from aiplot.generated.drafts.message_events import (
    DraftDoneEvent,
    DraftErrorEvent,
    DraftRepliedEvent,
    DraftReplyEvent,
    DraftSourceEvent,
)
from aiplot.generated.roles.source_output import SimilarName, SourceOutput
from aiplot.llm.client import LlmError, Message
from aiplot.llm.router import Router
from aiplot.services import draft_context as context
from aiplot.services.drafts import DraftState
from aiplot.services.names import similar_names
from aiplot.services.notes import EmptyNotesError, RevisedNotes, apply_edits
from aiplot.services.works import require_open

# source regenerates once when the notes would be emptied or a changed sentence is not a
# plain 다 statement; the second result is kept (§13).
SOURCE_ATTEMPTS = 2


class DraftBusyError(RuntimeError):
    """A turn is still running on this draft."""


class MessageEmptyError(ValueError):
    """Only a draft without turns takes an empty message (the AI's opening)."""


@dataclass(frozen=True)
class Turn:
    draft: DraftState
    text: str
    notes: str
    chat: list[Message]
    names: str
    # Every other card of the work by (id, name), and the edited card's own name: the
    # similar-name check.
    cards: list[tuple[str, str]]
    own_name: str | None


def prepare(conn: sqlite3.Connection, draft: DraftState, text: str, refs: list[str]) -> Turn:
    """Everything the turn needs from the database; refuses a locked stage (423) and a turn
    while another runs (409). The draft is marked busy only once the stream starts (converse),
    so a client gone before that never leaves it stuck."""
    require_open(conn, draft.work_id, 1)
    text = text.strip()
    with draft.lock:
        if draft.busy:
            raise DraftBusyError(draft.id)
        if not text and draft.turns:
            raise MessageEmptyError("an empty message only opens a new conversation")
        draft.refs = list(dict.fromkeys([*draft.refs, *refs]))
        notes = draft.notes
        turns = [*draft.turns, *([("user", text)] if text else [])]
        draft_refs = list(draft.refs)
        generated = draft.generated
    rows = cards_db.list_for_work(conn, draft.work_id)
    chat = context.chat_turns(
        notes,
        context.ref_lines(conn, context.mentioned(conn, draft.work_id, draft_refs)),
        draft.type,
        context.missing(draft.type, generated),
        turns,
    )
    return Turn(
        draft=draft,
        text=text,
        notes=notes,
        chat=chat,
        names=context.name_lines(rows, draft.card_id),
        cards=[(row.id, row.name) for row in rows if row.id != draft.card_id and row.name],
        own_name=next((row.name for row in rows if row.id == draft.card_id), None),
    )


def release(draft: DraftState) -> None:
    with draft.lock:
        draft.busy = False


async def revise(
    router: Router, messages: list[Message], notes: str
) -> tuple[RevisedNotes, SourceOutput]:
    """source with the §13 retries; an LLM error (after the router's own JSON retry) ends it."""
    kept: tuple[RevisedNotes, SourceOutput] | None = None
    for _ in range(SOURCE_ATTEMPTS):
        try:
            output = (await router.complete_json("source", messages, SourceOutput)).value
        except LlmError:
            # A usable (casual) first result stands if the extra try fails.
            if kept is not None:
                break
            raise
        try:
            applied = apply_edits(notes, output)
        except EmptyNotesError:
            continue
        kept = (applied, output)
        if not applied.casual:
            break
    if kept is None:
        raise LlmError("LLM_INVALID_OUTPUT", "source emptied the notes twice")
    return kept


async def name_checks(turn: Turn) -> list[SimilarName]:
    """Names the user wrote that are a letter or two off another card's name (§13): found in
    code (services/names), never by the model. Pure-Python edit distance over every card name
    takes a while for a long message, so it runs off the event loop."""
    pairs = await asyncio.to_thread(similar_names, turn.text, turn.cards, turn.own_name)
    return [
        SimilarName(mentioned=p.mentioned, similar_to=p.similar_to, card_id=p.card_id)
        for p in pairs
    ]


async def converse(router: Router, turn: Turn) -> AsyncIterator[tuple[str, BaseModel]]:
    """(event name, data) pairs in the order the client reads them, ending with done. A client
    that goes away closes the stream, which stops generation (§13) and frees the draft."""
    draft = turn.draft
    with draft.lock:
        taken = draft.busy
        draft.busy = True
    if taken:
        # Another turn started between prepare and now.
        yield "error", DraftErrorEvent(code="DRAFT_BUSY", message="the AI is still answering")
        yield "done", DraftDoneEvent()
        return
    try:
        async for event in events(router, turn):
            yield event
        yield "done", DraftDoneEvent()
    finally:
        release(draft)


async def events(router: Router, turn: Turn) -> AsyncIterator[tuple[str, BaseModel]]:
    draft = turn.draft
    pieces: list[str] = []
    try:
        async for piece in router.stream_text("chat", turn.chat):
            pieces.append(piece)
            yield "reply", DraftReplyEvent(text=piece)
    except LlmError as exc:
        yield "error", DraftErrorEvent(code=exc.code, message=str(exc))
        return
    reply = "".join(pieces).strip()
    with draft.lock:
        if turn.text:
            draft.turns.append(("user", turn.text))
        draft.turns.append(("ai", reply))
    if not turn.text:
        # The AI's opening question: nothing to fold into the notes yet.
        return
    yield "replied", DraftRepliedEvent(text=reply)
    messages = context.source_turns(turn.notes, turn.names, draft.type, turn.text, reply)
    try:
        revised, output = await revise(router, messages, turn.notes)
    except LlmError as exc:
        yield "error", DraftErrorEvent(code=exc.code, message=str(exc))
        return
    with draft.lock:
        if draft.notes != turn.notes:
            # The user edited the notes meanwhile; theirs win over edits by sentence index.
            stale = True
        else:
            draft.notes = revised.notes
            stale = False
    if stale:
        yield (
            "error",
            DraftErrorEvent(
                code="NOTES_CHANGED", message="the notes were edited while the AI was updating them"
            ),
        )
        return
    yield (
        "source",
        DraftSourceEvent(
            notes=revised.notes,
            sentences=revised.sentences,
            changed=revised.changed,
            questions=output.questions[:3],
            similar_names=await name_checks(turn),
        ),
    )
