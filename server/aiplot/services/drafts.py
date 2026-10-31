"""Drafts: the card drawer's working state (§8), in server memory only.

A draft holds the source notes being shaped, the conversation, the pinned fields and the last
generated card. Nothing of it is written to disk until 저장, and the conversation never is
(§6): DELETE, a save or a restart drops it.
"""

import secrets
import sqlite3
import threading
from dataclasses import dataclass, field
from typing import Literal

from aiplot.db import cards as cards_db
from aiplot.generated.card.card import Card
from aiplot.generated.drafts.draft import Draft, DraftTurn
from aiplot.generated.drafts.draft_create import DraftCreate
from aiplot.generated.roles.card_output import CardOutput
from aiplot.services import cards
from aiplot.services.notes import split_sentences
from aiplot.services.works import require_open

CardType = Literal["world", "character", "region", "main_story", "part", "episode"]
Category = Literal["rule", "faction", "history", "culture", "other"]


class DraftNotFoundError(LookupError):
    pass


class DraftInvalidError(ValueError):
    """The draft asks for something that does not fit (card of another type, a part that
    is not one, a category for a non-world card)."""


@dataclass
class DraftState:
    id: str
    work_id: str
    type: CardType
    card_id: str | None
    category: Category | None
    part_id: str | None
    notes: str
    # The saved card in edit mode: ids to keep and pinned values to restore on generation.
    saved: Card | None
    turns: list[tuple[Literal["user", "ai"], str]] = field(default_factory=list)
    pinned: list[str] = field(default_factory=list)
    generated: CardOutput | None = None
    # Cards @-mentioned so far: they stay in the roles' context.
    refs: list[str] = field(default_factory=list)
    # A chat turn is running (one at a time per draft).
    busy: bool = False
    # The generation job, and the notes the generated card was made from (its evidence
    # indexes point into them; 저장 needs them unchanged).
    job_id: str | None = None
    generated_notes: str | None = None
    # Requests on one draft may overlap (thread pool): every read and change holds this, so
    # a response never mixes two versions (e.g. notes from one, sentences from another).
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def view(self) -> Draft:
        with self.lock:
            notes = self.notes
            return Draft(
                id=self.id,
                work_id=self.work_id,
                type=self.type,
                card_id=self.card_id,
                category=self.category,
                part_id=self.part_id,
                notes=notes,
                sentences=split_sentences(notes),
                turns=[DraftTurn(role=role, text=text) for role, text in self.turns],
                pinned=list(self.pinned),
                generated=self.generated,
            )


class DraftStore:
    """Open drafts by id. Requests run on a thread pool, hence the lock."""

    def __init__(self) -> None:
        self._drafts: dict[str, DraftState] = {}
        self._lock = threading.Lock()

    def add(self, draft: DraftState) -> None:
        with self._lock:
            self._drafts[draft.id] = draft

    def get(self, draft_id: str) -> DraftState:
        with self._lock:
            draft = self._drafts.get(draft_id)
        if draft is None:
            raise DraftNotFoundError(draft_id)
        return draft

    def remove(self, draft_id: str) -> None:
        with self._lock:
            if self._drafts.pop(draft_id, None) is None:
                raise DraftNotFoundError(draft_id)


def new_draft_id() -> str:
    return f"dr_{secrets.token_hex(8)}"


def create(conn: sqlite3.Connection, store: DraftStore, work_id: str, body: DraftCreate) -> Draft:
    """Opens the drawer; locked planning never opens it (§8: 423)."""
    require_open(conn, work_id, 1)
    saved: Card | None = None
    if body.card_id is not None:
        saved = cards.get(conn, body.card_id)
        if saved is None or saved.work_id != work_id:
            raise cards.CardNotFoundError(body.card_id)
        if saved.type != body.type:
            raise DraftInvalidError(f"{body.card_id} is a {saved.type}, not a {body.type}")
    if body.category is not None and body.type != "world":
        raise DraftInvalidError("only a world card has a category")
    if body.part_id is not None:
        part = cards_db.get(conn, body.part_id)
        if body.type != "episode" or saved is not None:
            raise DraftInvalidError("only a new episode is placed in a part")
        if part is None or part.type != "part" or part.work_id != work_id:
            raise DraftInvalidError(f"{body.part_id} is not a part of this work")
    draft = DraftState(
        id=new_draft_id(),
        work_id=work_id,
        type=body.type,
        card_id=body.card_id,
        category=body.category,
        part_id=body.part_id,
        notes=saved.source_notes if saved is not None else "",
        saved=saved,
        pinned=list(saved.pinned) if saved is not None else [],
    )
    store.add(draft)
    return draft.view()


def set_notes(store: DraftStore, draft_id: str, notes: str) -> Draft:
    """The user edited the notes themselves (§8)."""
    draft = store.get(draft_id)
    with draft.lock:
        draft.notes = notes
    return draft.view()
