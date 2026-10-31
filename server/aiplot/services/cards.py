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
from aiplot.db import deletion
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
from aiplot.generated.card.card_references import CardReference
from aiplot.generated.card.completeness import (
    Completeness,
    ForeshadowingStatus,
    IncompleteCard,
    MilestoneFulfilment,
)
from aiplot.generated.card.region import RegionTravel
from aiplot.generated.card.region_links import RegionLinkRow
from aiplot.generated.card.relations import CardRelation
from aiplot.services.trash import Deleted, Trash
from aiplot.services.works import WorkNotFoundError, require_open

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
    # §15 requires a name only of these; parts have a title, episodes and the main story none.
    if card.type in ("world", "character", "region") and not filled(card.name):
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


def sync(conn: sqlite3.Connection, card: Card, before: db.CardRow | None) -> None:
    """before: the card as it was saved last, for links it claimed then."""
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
            old_links = (before.data.get("links") or {}) if before is not None else {}
            db.relink_order(
                conn,
                card.id,
                (old_links.get("prev"), old_links.get("next")),
                scope.one(data.links.prev, "episode"),
                scope.one(data.links.next, "episode"),
            )
            db.replace_causes(conn, card.id, scope.keep(list(data.links.causes), "episode"))
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
        # Stage 1 data stays as it was once direction started (§6: 423 STAGE_LOCKED).
        require_open(conn, card.work_id, 1)
        existing = db.get(conn, card.id)
        if existing is not None and (
            existing.work_id != card.work_id or existing.type != card.type
        ):
            raise CardConflictError(f"{card.id} is a {existing.type} of {existing.work_id}")
        db.upsert(conn, to_row(card, "incomplete"))
        sync(conn, card, existing)
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


class CardNotFoundError(LookupError):
    pass


class NotARegionError(ValueError):
    """Only a region's map position is edited directly (§6)."""


def require(conn: sqlite3.Connection, card_id: str) -> db.CardRow:
    row = db.get(conn, card_id)
    if row is None:
        raise CardNotFoundError(card_id)
    return row


def list_cards(
    conn: sqlite3.Connection, work_id: str, card_type: str | None, query: str | None
) -> list[Card]:
    if works_db.get(conn, work_id) is None:
        raise WorkNotFoundError(work_id)
    if query is not None and query.strip():
        rows = db.search_names(conn, work_id, query, card_type)
    else:
        rows = db.list_for_work(conn, work_id, card_type)
    return [from_row(conn, row) for row in rows]


def references(conn: sqlite3.Connection, card_id: str) -> list[CardReference]:
    require(conn, card_id)
    result = []
    for ref_id, field in db.references(conn, card_id):
        ref = db.get(conn, ref_id)
        if ref is not None:
            result.append(
                CardReference.model_validate(
                    {"card_id": ref.id, "type": ref.type, "name": ref.name, "field": field}
                )
            )
    return result


def set_position(conn: sqlite3.Connection, card_id: str, x: float, y: float) -> Card:
    """The map moves a region (§8); locked once stage 1 is (423)."""
    with transaction(conn):
        row = require(conn, card_id)
        if row.type != "region":
            raise NotARegionError(f"{card_id} is a {row.type}")
        require_open(conn, row.work_id, 1)
        db.set_region_position(conn, card_id, x, y)
    card = get(conn, card_id)
    assert card is not None
    return card


def completeness(conn: sqlite3.Connection, work_id: str) -> Completeness:
    if works_db.get(conn, work_id) is None:
        raise WorkNotFoundError(work_id)
    return Completeness(
        milestones=[
            MilestoneFulfilment(
                id=m.id, order=m.order, text=m.text, parts=m.parts, episodes=m.episodes
            )
            for m in db.milestones_of_work(conn, work_id)
        ],
        foreshadowing=[
            ForeshadowingStatus(id=fid, text=text, plant_episode_id=plant, payoff_episode_id=payoff)
            for fid, text, plant, payoff in db.foreshadowing_of_work(conn, work_id)
        ],
        incomplete=[
            IncompleteCard.model_validate({"card_id": row.id, "type": row.type, "name": row.name})
            for row in db.list_for_work(conn, work_id)
            if row.status == "incomplete"
        ],
    )


# Delete and restore (§8, §16) ------------------------------------------------------------


class PartHasEpisodesError(ValueError):
    """A part with episodes needs ?episodes=move:{partId}|delete (409 PART_HAS_EPISODES)."""

    def __init__(self, count: int) -> None:
        super().__init__(f"the part has {count} episodes: move or delete them")
        self.count = count


class EpisodesTargetError(ValueError):
    """?episodes= is not move:{another part of the work} or delete."""


class RestoreExpiredError(LookupError):
    """Nothing to restore: the window passed, or it was restored already."""


def delete(
    conn: sqlite3.Connection,
    trash: Trash,
    card_id: str,
    *,
    reconnect: bool = False,
    episodes: str | None = None,
) -> Deleted:
    """Deletes the card and every relation row touching it in one transaction, and keeps
    what that removed or changed for a restore. reconnect: an episode's prev and next are
    linked to each other. episodes: what happens to a part's episodes."""
    with transaction(conn):
        row = require(conn, card_id)
        require_open(conn, row.work_id, 1)
        ids = [card_id]
        moves: list[tuple[str, str | None, int | None, int]] = []
        target: str | None = None
        if row.type == "part":
            members = deletion.episodes_of_part(conn, card_id)
            if members and episodes is None:
                raise PartHasEpisodesError(len(members))
            if members and episodes == "delete":
                ids += [episode_id for episode_id, _ in members]
            elif members and episodes is not None and episodes.startswith("move:"):
                target = episodes.removeprefix("move:")
                other = db.get(conn, target)
                if (
                    other is None
                    or other.type != "part"
                    or other.work_id != row.work_id
                    or target == card_id
                ):
                    raise EpisodesTargetError(f"{target} is not another part of this work")
                start = deletion.last_order(conn, target)
                moves = [
                    (episode_id, card_id, order, start + i + 1)
                    for i, (episode_id, order) in enumerate(members)
                ]
            elif members:
                raise EpisodesTargetError(f"episodes={episodes} is not move:<partId> or delete")
        # Moved episodes keep their part (no ON DELETE SET NULL) and stay out of the snapshot.
        for episode_id, _, _, new_order in moves:
            deletion.move_episode(conn, episode_id, target, new_order)
        neighbours = (
            deletion.order_neighbours(conn, card_id)
            if reconnect and row.type == "episode"
            else None
        )
        referencing = {ref for card in ids for ref, _ in db.references(conn, card)}
        snapshot = deletion.capture(conn, ids)
        snapshot.moved = [(episode_id, old, order) for episode_id, old, order, _ in moves]
        deletion.delete_cards(conn, ids)
        if neighbours is not None:
            prev, nxt = neighbours
            if prev and nxt and deletion.link_order(conn, prev, nxt):
                snapshot.added_links.append((prev, nxt))
        recompute(conn, (referencing | deletion.touched_by(conn, snapshot)) - set(ids))
    return trash.put(card_id, row.work_id, snapshot)


def restore(conn: sqlite3.Connection, trash: Trash, card_id: str) -> Card:
    """Undoes a delete within its window (§8): rows, cleared columns, moved episodes and the
    reconnecting link. Relation rows whose other end is gone meanwhile are skipped."""
    deleted = trash.get(card_id)
    if deleted is None:
        raise RestoreExpiredError(card_id)
    with transaction(conn):
        try:
            require_open(conn, deleted.work_id, 1)
        except WorkNotFoundError as exc:
            raise RestoreExpiredError(card_id) from exc
        deletion.restore(conn, deleted.snapshot)
        recompute(conn, deletion.touched_by(conn, deleted.snapshot))
    trash.drop(card_id)
    card = get(conn, card_id)
    assert card is not None
    return card


def relations(conn: sqlite3.Connection, work_id: str, kind: str) -> list[CardRelation]:
    """The work's relation rows of one kind, from the relation tables (§6)."""
    if works_db.get(conn, work_id) is None:
        raise WorkNotFoundError(work_id)
    return [
        CardRelation(from_id=a, to_id=b, relation=text)
        for a, b, text in db.relations_of_work(conn, work_id, kind)
    ]


def region_links(conn: sqlite3.Connection, work_id: str) -> list[RegionLinkRow]:
    """The region map's lines (§8 S1-2), from region_link (§6)."""
    if works_db.get(conn, work_id) is None:
        raise WorkNotFoundError(work_id)
    return [
        RegionLinkRow(
            from_id=row["from_id"],
            to_id=row["to_id"],
            travel=None
            if row["travel_value"] is None or row["travel_unit"] is None
            else RegionTravel(
                value=row["travel_value"], unit=row["travel_unit"], mode=row["travel_mode"]
            ),
            direction=row["direction"],
        )
        for row in db.region_links_of_work(conn, work_id)
    ]
