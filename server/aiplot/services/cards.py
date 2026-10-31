"""Cards (§7, §14, §15): saving with relation sync and status, reading back.

Saving writes the card row, its type table and every relation row it owns in one
transaction (§5). References to cards outside the work, of the wrong type, or to itself are
not written; card data keeps what was generated, the relation tables hold what is real (§6).
"""

import secrets
import sqlite3
from typing import Any

from pydantic import TypeAdapter

from aiplot.db import cards as db
from aiplot.db import works as works_db
from aiplot.db.connection import transaction
from aiplot.generated.card.card import (
    Card,
    CharacterCard,
    EpisodeCard,
    MainStoryCard,
    PartCard,
    RegionCard,
    WorldCard,
)
from aiplot.services.works import WorkNotFoundError

CARD = TypeAdapter(Card)
SCHEMA_VERSION = 1
SPEECH_EXAMPLES = (3, 5)


class CardConflictError(ValueError):
    """The id belongs to another work or type, or a second main story was saved."""


def new_card_id() -> str:
    return f"c_{secrets.token_hex(8)}"


def filled(value: str | None) -> bool:
    return value is not None and value.strip() != ""


# Status (§15 required fields) -----------------------------------------------------------


def complete(conn: sqlite3.Connection, card: Card) -> bool:
    """True when every §15 required field is there; references count from relation tables."""
    if not filled(card.name) and card.type != "episode":
        return False
    match card:
        case WorldCard(data=data):
            return data.category is not None and filled(data.summary)
        case CharacterCard(data=data):
            low, high = SPEECH_EXAMPLES
            return (
                filled(data.theme)
                and data.personality is not None
                and len(data.personality.traits) >= 1
                and data.speech is not None
                and filled(data.speech.description)
                and low <= len(data.speech.examples) <= high
                and data.appearance is not None
                and filled(data.appearance.summary)
            )
        case RegionCard(data=data):
            return (
                filled(data.appearance)
                and data.environment is not None
                and filled(data.environment.natural)
                and filled(data.environment.social)
            )
        case MainStoryCard(data=data):
            return (
                filled(data.theme)
                and filled(data.premise)
                and filled(data.ending)
                and db.count_milestones(conn, card.id) >= 1
            )
        case PartCard(data=data):
            return (
                filled(data.title)
                and filled(data.theme)
                and filled(data.start)
                and filled(data.end)
            )
        case EpisodeCard(data=data):
            structure = data.structure
            return (
                filled(data.theme)
                and filled(data.synopsis)
                and db.count_episode_characters(conn, card.id) >= 1
                and db.has_main_region(conn, card.id)
                and structure is not None
                and all(filled(stage.summary) for stage in structure.stages)
            )
    return False


def recompute(conn: sqlite3.Connection, card_ids: set[str]) -> None:
    """Status of every card a write touched (§14)."""
    for card_id in card_ids:
        card = get(conn, card_id)
        if card is not None:
            db.set_status(conn, card_id, "complete" if complete(conn, card) else "incomplete")


# Relation sync ----------------------------------------------------------------------------


class Scope:
    """What a card may point at: cards of the same work, by type (never itself)."""

    def __init__(self, conn: sqlite3.Connection, work_id: str, self_id: str) -> None:
        self.conn = conn
        self.work_id = work_id
        self.self_id = self_id
        self._cache: dict[tuple[str, ...], set[str]] = {}

    def ids(self, *types: str) -> set[str]:
        if types not in self._cache:
            self._cache[types] = db.ids_of(self.conn, self.work_id, types) - {self.self_id}
        return self._cache[types]

    def keep(self, ids: list[str], *types: str) -> list[str]:
        known = self.ids(*types)
        return list(dict.fromkeys(i for i in ids if i in known))

    def one(self, card_id: str | None, *types: str) -> str | None:
        return card_id if card_id is not None and card_id in self.ids(*types) else None


def claim(conn: sqlite3.Connection, table: str, owner: str, card_id: str, ids: list[str]) -> None:
    """ms_/fs_ ids are the server's and unique (§13): one held by another card is a conflict,
    never taken over."""
    for item, holder in db.owners(conn, table, owner, ids).items():
        if holder != card_id:
            raise CardConflictError(f"{item} belongs to {holder}")


def sync(conn: sqlite3.Connection, card: Card) -> None:
    scope = Scope(conn, card.work_id, card.id)
    match card:
        case WorldCard(data=data):
            db.put_world(conn, card.id, data.category, data.summary)
            related = scope.keep(list(data.related), "character", "region", "world")
            db.replace_pairs(conn, "world_relation", "world_id", "card_id", card.id, related)
        case CharacterCard(data=data):
            db.put_character(
                conn,
                card.id,
                data.theme,
                None if data.personality is None else data.personality.model_dump(mode="json"),
                None if data.speech is None else data.speech.model_dump(mode="json"),
                None if data.appearance is None else data.appearance.summary,
                scope.one(data.origin_region_id, "region"),
            )
            targets = scope.ids("character")
            relations = [
                (r.target_id, r.relation) for r in data.relations if r.target_id in targets
            ]
            db.replace_char_relations(conn, card.id, relations)
        case RegionCard(data=data):
            db.put_region(
                conn,
                card.id,
                scope.one(data.parent_id, "region"),
                None if data.environment is None else data.environment.model_dump(mode="json"),
                None if data.sensory is None else data.sensory.model_dump(mode="json"),
            )
            regions = scope.ids("region")
            links = [
                db.Travel(
                    target=link.target_id,
                    value=None if link.travel is None else link.travel.value,
                    unit=None if link.travel is None else link.travel.unit,
                    mode=None if link.travel is None else link.travel.mode,
                    direction=link.direction,
                )
                for link in data.links
                if link.target_id in regions
            ]
            db.replace_region_links(conn, card.id, links)
        case MainStoryCard(data=data):
            other = db.main_story_of(conn, card.work_id)
            if other is not None and other != card.id:
                raise CardConflictError(f"work {card.work_id} already has a main story {other}")
            claim(conn, "milestone", "main_id", card.id, [m.id for m in data.milestones])
            db.put_main_story(conn, card.id, data.theme, data.premise, data.ending)
            db.replace_milestones(conn, card.id, [(m.id, m.order, m.text) for m in data.milestones])
        case PartCard(data=data):
            db.put_part(
                conn,
                card.id,
                db.main_story_of(conn, card.work_id),
                data.order,
                data.start,
                data.end,
            )
            milestones = db.milestone_ids(conn, card.work_id)
            db.replace_fills(conn, card.id, [m for m in data.fulfills if m in milestones])
        case EpisodeCard(data=data):
            worldlines = db.worldline_ids(conn, card.work_id)
            db.put_episode(
                conn,
                card.id,
                scope.one(data.part_id, "part"),
                data.order,
                None if data.structure is None else data.structure.model_dump(mode="json"),
                data.worldline_id if data.worldline_id in worldlines else None,
            )
            characters = scope.keep(list(data.characters), "character")
            db.replace_pairs(
                conn, "episode_character", "episode_id", "card_id", card.id, characters
            )
            db.replace_episode_regions(
                conn,
                card.id,
                scope.one(data.locations.main, "region"),
                scope.keep(list(data.locations.others), "region"),
            )
            worlds = scope.keep(list(data.world), "world")
            db.replace_pairs(conn, "episode_world", "episode_id", "card_id", card.id, worlds)
            db.replace_episode_links(
                conn,
                card.id,
                scope.one(data.links.prev, "episode"),
                scope.one(data.links.next, "episode"),
                scope.keep(list(data.links.causes), "episode"),
            )
            milestones = db.milestone_ids(conn, card.work_id)
            db.replace_fills(conn, card.id, [m for m in data.fulfills if m in milestones])
            plants = [(p.id, p.text) for p in data.foreshadowing.plants]
            claim(conn, "foreshadowing", "plant_episode_id", card.id, [p[0] for p in plants])
            db.replace_plants(conn, card.id, plants)
            planted = db.foreshadowing_ids(conn, card.work_id)
            payoffs = [
                fid
                for fid in data.foreshadowing.payoffs
                if fid in planted and planted[fid] != card.id
            ]
            db.replace_payoffs(conn, card.id, payoffs)


# Save and read ----------------------------------------------------------------------------


def to_row(card: Card, status: str) -> db.CardRow:
    return db.CardRow(
        id=card.id,
        work_id=card.work_id,
        type=card.type,
        name=card.name,
        source_notes=card.source_notes,
        data=card.data.model_dump(mode="json"),
        evidence={k: list(v) for k, v in card.evidence.items()},
        ai_guess=list(card.ai_guess),
        pinned=list(card.pinned),
        status=status,
        schema_version=SCHEMA_VERSION,
    )


def save(conn: sqlite3.Connection, card: Card) -> Card:
    """Card row + type table + its relation rows + status, in one transaction. card.status
    and a region's position are ignored (computed; the map owns the position)."""
    with transaction(conn):
        if works_db.get(conn, card.work_id) is None:
            raise WorkNotFoundError(card.work_id)
        existing = db.get(conn, card.id)
        if existing is not None and (
            existing.work_id != card.work_id or existing.type != card.type
        ):
            raise CardConflictError(f"{card.id} is a {existing.type} of {existing.work_id}")
        db.upsert(conn, to_row(card, "incomplete"))
        sync(conn, card)
        recompute(conn, {card.id})
    saved = get(conn, card.id)
    assert saved is not None
    return saved


def from_row(conn: sqlite3.Connection, row: db.CardRow) -> Card:
    value: dict[str, Any] = {
        "id": row.id,
        "work_id": row.work_id,
        "type": row.type,
        "name": row.name,
        "status": row.status,
        "source_notes": row.source_notes,
        "data": row.data,
        "evidence": row.evidence,
        "ai_guess": row.ai_guess,
        "pinned": row.pinned,
        "schema_version": row.schema_version,
    }
    if row.type == "region":
        position = db.region_position(conn, row.id)
        value["position"] = (
            None if position is None else {"map_x": position[0], "map_y": position[1]}
        )
    return CARD.validate_python(value)


def get(conn: sqlite3.Connection, card_id: str) -> Card | None:
    row = db.get(conn, card_id)
    return None if row is None else from_row(conn, row)
