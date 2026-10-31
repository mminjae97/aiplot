"""SQL for cards: the card row, its type table, and the relation tables (§14)."""

import json
import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

CARD_COLUMNS = (
    "id, work_id, type, name, source_notes, data, evidence, ai_guess, pinned_fields, status, "
    "schema_version"
)


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


@dataclass(frozen=True)
class CardRow:
    id: str
    work_id: str
    type: str
    name: str | None
    source_notes: str
    data: dict[str, Any]
    evidence: dict[str, list[int]]
    ai_guess: list[str]
    pinned: list[str]
    status: str
    schema_version: int


def to_row(row: sqlite3.Row) -> CardRow:
    return CardRow(
        id=row["id"],
        work_id=row["work_id"],
        type=row["type"],
        name=row["name"],
        source_notes=row["source_notes"],
        data=json.loads(row["data"]),
        evidence=json.loads(row["evidence"]),
        ai_guess=json.loads(row["ai_guess"]),
        pinned=json.loads(row["pinned_fields"]),
        status=row["status"],
        schema_version=row["schema_version"],
    )


# Card row ---------------------------------------------------------------------------------


def get(conn: sqlite3.Connection, card_id: str) -> CardRow | None:
    row = conn.execute(f"SELECT {CARD_COLUMNS} FROM card WHERE id = ?", (card_id,)).fetchone()
    return to_row(row) if row else None


def list_for_work(
    conn: sqlite3.Connection, work_id: str, card_type: str | None = None
) -> list[CardRow]:
    sql = f"SELECT {CARD_COLUMNS} FROM card WHERE work_id = ?"
    args: list[Any] = [work_id]
    if card_type is not None:
        sql += " AND type = ?"
        args.append(card_type)
    rows = conn.execute(f"{sql} ORDER BY rowid", args).fetchall()
    return [to_row(row) for row in rows]


def search_names(
    conn: sqlite3.Connection, work_id: str, query: str, card_type: str | None = None
) -> list[CardRow]:
    """Cards whose name has a word starting with each word of query (FTS5 prefix match)."""
    words = query.split()
    if not words:
        return []
    # Each word quoted, so FTS5 syntax in user input is plain text.
    match = " ".join('"' + word.replace('"', '""') + '"*' for word in words)
    sql = (
        f"SELECT {', '.join('card.' + c.strip() for c in CARD_COLUMNS.split(','))} "
        "FROM card_name JOIN card ON card.rowid = card_name.rowid "
        "WHERE card_name MATCH ? AND card.work_id = ?"
    )
    args: list[Any] = [match, work_id]
    if card_type is not None:
        sql += " AND card.type = ?"
        args.append(card_type)
    rows = conn.execute(f"{sql} ORDER BY card_name.rank, card.rowid", args).fetchall()
    return [to_row(row) for row in rows]


def upsert(conn: sqlite3.Connection, card: CardRow) -> None:
    conn.execute(
        f"INSERT INTO card ({CARD_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT (id) DO UPDATE SET name = excluded.name, "
        "source_notes = excluded.source_notes, data = excluded.data, "
        "evidence = excluded.evidence, ai_guess = excluded.ai_guess, "
        "pinned_fields = excluded.pinned_fields, status = excluded.status, "
        "schema_version = excluded.schema_version",
        (
            card.id,
            card.work_id,
            card.type,
            card.name,
            card.source_notes,
            dumps(card.data),
            dumps(card.evidence),
            dumps(card.ai_guess),
            dumps(card.pinned),
            card.status,
            card.schema_version,
        ),
    )


def set_status(conn: sqlite3.Connection, card_id: str, status: str) -> None:
    conn.execute("UPDATE card SET status = ? WHERE id = ?", (status, card_id))


def ids_of(conn: sqlite3.Connection, work_id: str, types: Iterable[str]) -> set[str]:
    """Card ids of these types in the work."""
    kinds = list(types)
    marks = ", ".join("?" for _ in kinds)
    rows = conn.execute(
        f"SELECT id FROM card WHERE work_id = ? AND type IN ({marks})", (work_id, *kinds)
    ).fetchall()
    return {row["id"] for row in rows}


# Type tables ------------------------------------------------------------------------------


def put_world(
    conn: sqlite3.Connection, card_id: str, category: str | None, summary: str | None
) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO world (card_id, category, summary) VALUES (?, ?, ?)",
        (card_id, category, summary),
    )


def put_character(
    conn: sqlite3.Connection,
    card_id: str,
    theme: str | None,
    personality: Any,
    speech: Any,
    appearance_init: str | None,
    origin_region_id: str | None,
) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO character "
        "(card_id, theme, personality, speech, appearance_init, origin_region_id) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (card_id, theme, dumps(personality), dumps(speech), appearance_init, origin_region_id),
    )


def put_region(
    conn: sqlite3.Connection,
    card_id: str,
    parent_region_id: str | None,
    environment: Any,
    sensory: Any,
) -> None:
    # The map position survives regeneration (§8: only the map moves it).
    conn.execute(
        "INSERT INTO region (card_id, parent_region_id, environment, sensory) "
        "VALUES (?, ?, ?, ?) ON CONFLICT (card_id) DO UPDATE SET "
        "parent_region_id = excluded.parent_region_id, environment = excluded.environment, "
        "sensory = excluded.sensory",
        (card_id, parent_region_id, dumps(environment), dumps(sensory)),
    )


def region_position(conn: sqlite3.Connection, card_id: str) -> tuple[float, float] | None:
    row = conn.execute("SELECT map_x, map_y FROM region WHERE card_id = ?", (card_id,)).fetchone()
    if row is None or row["map_x"] is None or row["map_y"] is None:
        return None
    return float(row["map_x"]), float(row["map_y"])


def set_region_position(conn: sqlite3.Connection, card_id: str, x: float, y: float) -> None:
    conn.execute("UPDATE region SET map_x = ?, map_y = ? WHERE card_id = ?", (x, y, card_id))


def put_main_story(
    conn: sqlite3.Connection,
    card_id: str,
    theme: str | None,
    premise: str | None,
    ending: str | None,
) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO main_story (card_id, theme, premise, ending) VALUES (?, ?, ?, ?)",
        (card_id, theme, premise, ending),
    )


def put_part(
    conn: sqlite3.Connection,
    card_id: str,
    main_id: str | None,
    order: int | None,
    start: str | None,
    end: str | None,
) -> None:
    conn.execute(
        'INSERT OR REPLACE INTO part (card_id, main_id, "order", start, "end") '
        "VALUES (?, ?, ?, ?, ?)",
        (card_id, main_id, order, start, end),
    )


def put_episode(
    conn: sqlite3.Connection,
    card_id: str,
    part_id: str | None,
    order: int | None,
    structure: Any,
    worldline_id: str | None,
) -> None:
    # summary is written in stage 3 and kept here.
    conn.execute(
        'INSERT INTO episode (card_id, part_id, "order", structure, worldline_id) '
        "VALUES (?, ?, ?, ?, ?) ON CONFLICT (card_id) DO UPDATE SET "
        'part_id = excluded.part_id, "order" = excluded."order", '
        "structure = excluded.structure, worldline_id = excluded.worldline_id",
        (card_id, part_id, order, None if structure is None else dumps(structure), worldline_id),
    )


def main_story_of(conn: sqlite3.Connection, work_id: str) -> str | None:
    row = conn.execute(
        "SELECT id FROM card WHERE work_id = ? AND type = 'main_story' ORDER BY rowid LIMIT 1",
        (work_id,),
    ).fetchone()
    return str(row["id"]) if row else None


def worldline_ids(conn: sqlite3.Connection, work_id: str) -> set[str]:
    rows = conn.execute("SELECT id FROM worldline WHERE work_id = ?", (work_id,)).fetchall()
    return {row["id"] for row in rows}


# Relation tables --------------------------------------------------------------------------


def replace_milestones(
    conn: sqlite3.Connection, main_id: str, milestones: list[tuple[str, int, str]]
) -> None:
    """(id, order, text) for this main story; dropped ones take their fills with them."""
    keep = [m[0] for m in milestones]
    marks = ", ".join("?" for _ in keep)
    conn.execute(
        f"DELETE FROM milestone WHERE main_id = ? AND id NOT IN ({marks})", (main_id, *keep)
    )
    conn.executemany(
        'INSERT INTO milestone (id, main_id, "order", text) VALUES (?, ?, ?, ?) '
        'ON CONFLICT (id) DO UPDATE SET "order" = excluded."order", text = excluded.text',
        [(mid, main_id, order, text) for mid, order, text in milestones],
    )


def owners(conn: sqlite3.Connection, table: str, owner: str, ids: list[str]) -> dict[str, str]:
    """id -> owning card for milestone (main_id) or foreshadowing (plant_episode_id) rows."""
    marks = ", ".join("?" for _ in ids)
    rows = conn.execute(f"SELECT id, {owner} FROM {table} WHERE id IN ({marks})", ids).fetchall()
    return {row["id"]: row[owner] for row in rows}


def milestone_ids(conn: sqlite3.Connection, work_id: str) -> set[str]:
    rows = conn.execute(
        "SELECT milestone.id FROM milestone JOIN card ON card.id = milestone.main_id "
        "WHERE card.work_id = ?",
        (work_id,),
    ).fetchall()
    return {row["id"] for row in rows}


def count_milestones(conn: sqlite3.Connection, main_id: str) -> int:
    row = conn.execute("SELECT count(*) FROM milestone WHERE main_id = ?", (main_id,)).fetchone()
    return int(row[0])


def replace_fills(conn: sqlite3.Connection, card_id: str, milestone_ids: list[str]) -> None:
    conn.execute("DELETE FROM milestone_fill WHERE card_id = ?", (card_id,))
    conn.executemany(
        "INSERT OR IGNORE INTO milestone_fill (milestone_id, card_id) VALUES (?, ?)",
        [(mid, card_id) for mid in milestone_ids],
    )


def replace_pairs(
    conn: sqlite3.Connection, table: str, owner: str, other: str, owner_id: str, ids: list[str]
) -> None:
    """Rows (owner, other) of a two-column relation table, replaced for one owner."""
    conn.execute(f"DELETE FROM {table} WHERE {owner} = ?", (owner_id,))
    conn.executemany(
        f"INSERT OR IGNORE INTO {table} ({owner}, {other}) VALUES (?, ?)",
        [(owner_id, target) for target in ids],
    )


def replace_char_relations(
    conn: sqlite3.Connection, card_id: str, relations: list[tuple[str, str]]
) -> None:
    conn.execute("DELETE FROM char_relation WHERE from_id = ?", (card_id,))
    conn.executemany(
        "INSERT OR REPLACE INTO char_relation (from_id, to_id, relation) VALUES (?, ?, ?)",
        [(card_id, target, relation) for target, relation in relations],
    )


@dataclass(frozen=True)
class Travel:
    target: str
    value: float | None
    unit: str | None
    mode: str | None
    direction: str | None


def replace_region_links(conn: sqlite3.Connection, card_id: str, links: list[Travel]) -> None:
    conn.execute("DELETE FROM region_link WHERE from_id = ?", (card_id,))
    conn.executemany(
        "INSERT OR REPLACE INTO region_link "
        "(from_id, to_id, travel_value, travel_unit, travel_mode, direction) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        [(card_id, t.target, t.value, t.unit, t.mode, t.direction) for t in links],
    )


def replace_episode_regions(
    conn: sqlite3.Connection, card_id: str, main: str | None, others: list[str]
) -> None:
    conn.execute("DELETE FROM episode_region WHERE episode_id = ?", (card_id,))
    rows = [(card_id, main, 1)] if main else []
    rows += [(card_id, other, 0) for other in others if other != main]
    conn.executemany(
        "INSERT OR IGNORE INTO episode_region (episode_id, card_id, main) VALUES (?, ?, ?)", rows
    )


def has_main_region(conn: sqlite3.Connection, episode_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM episode_region WHERE episode_id = ? AND main = 1", (episode_id,)
    ).fetchone()
    return row is not None


def count_episode_characters(conn: sqlite3.Connection, episode_id: str) -> int:
    row = conn.execute(
        "SELECT count(*) FROM episode_character WHERE episode_id = ?", (episode_id,)
    ).fetchone()
    return int(row[0])


def replace_episode_links(
    conn: sqlite3.Connection,
    card_id: str,
    prev: str | None,
    next_id: str | None,
    causes: list[str],
) -> None:
    """The episode's own links: its prev and next in order, and the episodes it causes."""
    conn.execute(
        "DELETE FROM episode_link WHERE (kind = 'order' AND (from_id = ? OR to_id = ?)) "
        "OR (kind = 'cause' AND from_id = ?)",
        (card_id, card_id, card_id),
    )
    rows = [(prev, card_id, "order")] if prev else []
    rows += [(card_id, next_id, "order")] if next_id else []
    rows += [(card_id, target, "cause") for target in causes]
    conn.executemany(
        "INSERT OR IGNORE INTO episode_link (from_id, to_id, kind) VALUES (?, ?, ?)", rows
    )


def replace_plants(
    conn: sqlite3.Connection, episode_id: str, plants: list[tuple[str, str]]
) -> None:
    """(id, text) planted in this episode; a payoff elsewhere keeps pointing at kept ids."""
    keep = [p[0] for p in plants]
    marks = ", ".join("?" for _ in keep)
    conn.execute(
        f"DELETE FROM foreshadowing WHERE plant_episode_id = ? AND id NOT IN ({marks})",
        (episode_id, *keep),
    )
    conn.executemany(
        "INSERT INTO foreshadowing (id, plant_episode_id, text) VALUES (?, ?, ?) "
        "ON CONFLICT (id) DO UPDATE SET text = excluded.text",
        [(fid, episode_id, text) for fid, text in plants],
    )


def foreshadowing_ids(conn: sqlite3.Connection, work_id: str) -> dict[str, str]:
    """fs id -> planting episode, for the work."""
    rows = conn.execute(
        "SELECT foreshadowing.id, plant_episode_id FROM foreshadowing "
        "JOIN card ON card.id = foreshadowing.plant_episode_id WHERE card.work_id = ?",
        (work_id,),
    ).fetchall()
    return {row["id"]: row["plant_episode_id"] for row in rows}


def replace_payoffs(conn: sqlite3.Connection, episode_id: str, ids: list[str]) -> None:
    conn.execute(
        "UPDATE foreshadowing SET payoff_episode_id = NULL WHERE payoff_episode_id = ?",
        (episode_id,),
    )
    conn.executemany(
        "UPDATE foreshadowing SET payoff_episode_id = ? WHERE id = ?",
        [(episode_id, fid) for fid in ids],
    )
