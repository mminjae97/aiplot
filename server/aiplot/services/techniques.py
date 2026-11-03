"""Direction technique cards (§9): the catalog in server/data/techniques, one file per category,
checked and loaded into the database at server start; listed and read by the app."""

import json
import sqlite3
from pathlib import Path

from pydantic import TypeAdapter, ValidationError

from aiplot.db import techniques as techniques_db
from aiplot.db.connection import transaction
from aiplot.generated.technique.technique import Technique
from aiplot.generated.technique.technique_summary import TechniqueSummary
from aiplot.llm.config import SERVER_DIR

TECHNIQUES_DIR = SERVER_DIR / "data" / "techniques"

FILE = TypeAdapter(list[Technique])


class TechniqueDataError(Exception):
    """The catalog files are broken: a bug in the shipped data, not a user error."""


def load(directory: Path = TECHNIQUES_DIR) -> list[Technique]:
    """Every card of every {category}.json, checked: schema, the file matching the category and
    id, unique ids, references to cards that exist (never itself), no pair that also conflicts."""
    cards: list[Technique] = []
    for path in sorted(directory.glob("*.json")):
        try:
            found = FILE.validate_json(path.read_bytes())
        except (ValidationError, json.JSONDecodeError) as exc:
            raise TechniqueDataError(f"{path.name}: {exc}") from exc
        for card in found:
            if card.category != path.stem or not card.id.startswith(f"tech_{path.stem}_"):
                raise TechniqueDataError(f"{path.name}: {card.id} is not of this category")
        cards += found
    if not cards:
        raise TechniqueDataError(f"no technique cards in {directory}")
    ids = [card.id for card in cards]
    if len(set(ids)) != len(ids):
        raise TechniqueDataError("duplicate technique ids")
    known = set(ids)
    conflicts = {(c.id, o) for c in cards for o in c.conflicts_with}
    conflicts |= {(o, a) for a, o in conflicts}
    for card in cards:
        for other in [*card.pairs_with, *card.conflicts_with]:
            if other not in known or other == card.id:
                raise TechniqueDataError(f"{card.id}: bad reference {other}")
        for other in card.pairs_with:
            if (card.id, other) in conflicts:
                raise TechniqueDataError(f"{card.id}: {other} both pairs and conflicts")
    return sorted(cards, key=lambda card: card.id)


def sync(conn: sqlite3.Connection, techniques: list[Technique]) -> None:
    """The database catalog becomes exactly the files' (one transaction)."""
    with transaction(conn):
        techniques_db.replace_all(conn, techniques)


def summary(card: Technique) -> TechniqueSummary:
    return TechniqueSummary.model_validate(
        card.model_dump(
            include={
                "id",
                "category",
                "name",
                "name_en",
                "scope",
                "effects",
                "situations",
                "description",
            }
        )
    )


def search(conn: sqlite3.Connection, q: str | None) -> list[TechniqueSummary]:
    """All techniques in id order; q keeps those whose name, English name or an alias contains
    it (case and spacing ignored)."""
    cards = techniques_db.list_all(conn)
    needle = "".join((q or "").split()).casefold()
    if needle:
        cards = [
            card
            for card in cards
            if any(
                needle in "".join(text.split()).casefold()
                for text in [card.name, card.name_en, *card.aliases]
            )
        ]
    return [summary(card) for card in cards]


def get(conn: sqlite3.Connection, technique_id: str) -> Technique | None:
    return techniques_db.get(conn, technique_id)
