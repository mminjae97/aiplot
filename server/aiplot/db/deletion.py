"""SQL for deleting cards with everything a delete removes or changes, and putting it back.

A snapshot holds every row the delete removes (the cards, their type rows, milestones,
foreshadowing and relation rows touching them), every column it clears (ON DELETE SET NULL
in other cards' rows) and every row it changes (moved episodes, a reconnecting link), so a
restore within a few seconds undoes all of it (§8 되돌리기).
"""

import sqlite3
from dataclasses import dataclass, field
from typing import Any

# Type tables: one row per card, keyed by card_id.
TYPE_TABLES = ("world", "character", "region", "main_story", "part", "episode")

# Relation tables and their columns that hold card ids.
RELATION_TABLES: dict[str, tuple[str, ...]] = {
    "milestone_fill": ("card_id",),
    "region_link": ("from_id", "to_id"),
    "char_relation": ("from_id", "to_id"),
    "world_relation": ("world_id", "card_id"),
    "episode_character": ("episode_id", "card_id"),
    "episode_region": ("episode_id", "card_id"),
    "episode_world": ("episode_id", "card_id"),
    "episode_link": ("from_id", "to_id"),
}

# (table, key column, column) cleared by ON DELETE SET NULL when the card it names goes.
NULLED: tuple[tuple[str, str, str], ...] = (
    ("character", "card_id", "origin_region_id"),
    ("region", "card_id", "parent_region_id"),
    ("part", "card_id", "main_id"),
    ("episode", "card_id", "part_id"),
    ("foreshadowing", "id", "payoff_episode_id"),
    ("worldline", "id", "branch_episode_id"),
)


@dataclass
class Snapshot:
    # (table, row incl. its rowid) in insert order: cards first, then what depends on them.
    rows: list[tuple[str, dict[str, Any]]] = field(default_factory=list)
    # (table, key column, key, column, old value)
    nulled: list[tuple[str, str, Any, str, Any]] = field(default_factory=list)
    # (episode id, old part_id, old order) of episodes moved to another part.
    moved: list[tuple[str, str | None, int | None]] = field(default_factory=list)
    # Order links the delete added (reconnecting prev and next).
    added_links: list[tuple[str, str]] = field(default_factory=list)


def _select(conn: sqlite3.Connection, sql: str, args: tuple[Any, ...]) -> list[dict[str, Any]]:
    return [dict(row) for row in conn.execute(sql, args).fetchall()]


def _marks(ids: list[str]) -> str:
    return ", ".join("?" for _ in ids)


def capture(conn: sqlite3.Connection, ids: list[str]) -> Snapshot:
    """Everything deleting these cards removes or clears, read before the delete."""
    snap = Snapshot()
    marks = _marks(ids)
    args = tuple(ids)
    for row in _select(
        conn, f"SELECT rowid, * FROM card WHERE id IN ({marks}) ORDER BY rowid", args
    ):
        snap.rows.append(("card", row))
    for table in TYPE_TABLES:
        for row in _select(conn, f"SELECT rowid, * FROM {table} WHERE card_id IN ({marks})", args):
            snap.rows.append((table, row))
    for row in _select(conn, f"SELECT rowid, * FROM milestone WHERE main_id IN ({marks})", args):
        snap.rows.append(("milestone", row))
    for row in _select(
        conn,
        "SELECT milestone_fill.rowid, milestone_fill.* FROM milestone_fill JOIN milestone "
        f"ON milestone.id = milestone_fill.milestone_id WHERE milestone.main_id IN ({marks})",
        args,
    ):
        snap.rows.append(("milestone_fill", row))
    for row in _select(
        conn, f"SELECT rowid, * FROM foreshadowing WHERE plant_episode_id IN ({marks})", args
    ):
        snap.rows.append(("foreshadowing", row))
    for table, columns in RELATION_TABLES.items():
        where = " OR ".join(f"{column} IN ({marks})" for column in columns)
        for row in _select(
            conn, f"SELECT rowid, * FROM {table} WHERE {where}", args * len(columns)
        ):
            if (table, row) not in snap.rows:
                snap.rows.append((table, row))
    for table, key, column in NULLED:
        rows = conn.execute(
            f"SELECT {key}, {column} FROM {table} WHERE {column} IN ({marks})", args
        ).fetchall()
        # A deleted card's own type row is captured whole above.
        snap.nulled += [
            (table, key, row[0], column, row[1])
            for row in rows
            if not (key == "card_id" and row[0] in ids)
        ]
    return snap


def delete_cards(conn: sqlite3.Connection, ids: list[str]) -> None:
    """Rows of other tables follow by ON DELETE CASCADE / SET NULL (captured beforehand)."""
    conn.execute(f"DELETE FROM card WHERE id IN ({_marks(ids)})", tuple(ids))


def order_neighbours(conn: sqlite3.Connection, episode_id: str) -> tuple[str | None, str | None]:
    prev = conn.execute(
        "SELECT from_id FROM episode_link WHERE to_id = ? AND kind = 'order'", (episode_id,)
    ).fetchone()
    nxt = conn.execute(
        "SELECT to_id FROM episode_link WHERE from_id = ? AND kind = 'order'", (episode_id,)
    ).fetchone()
    return (prev[0] if prev else None), (nxt[0] if nxt else None)


def link_order(conn: sqlite3.Connection, from_id: str, to_id: str) -> bool:
    """Adds from -> to unless either already has a neighbour on that side."""
    taken = conn.execute(
        "SELECT 1 FROM episode_link WHERE kind = 'order' AND (from_id = ? OR to_id = ?)",
        (from_id, to_id),
    ).fetchone()
    if taken:
        return False
    conn.execute(
        "INSERT INTO episode_link (from_id, to_id, kind) VALUES (?, ?, 'order')", (from_id, to_id)
    )
    return True


def episodes_of_part(conn: sqlite3.Connection, part_id: str) -> list[tuple[str, int | None]]:
    rows = conn.execute(
        'SELECT card_id, "order" FROM episode WHERE part_id = ? ORDER BY "order", rowid',
        (part_id,),
    ).fetchall()
    return [(row[0], row[1]) for row in rows]


def last_order(conn: sqlite3.Connection, part_id: str) -> int:
    row = conn.execute(
        'SELECT coalesce(max("order"), 0) FROM episode WHERE part_id = ?', (part_id,)
    ).fetchone()
    return int(row[0])


def move_episode(
    conn: sqlite3.Connection, episode_id: str, part_id: str | None, order: int | None
) -> None:
    conn.execute(
        'UPDATE episode SET part_id = ?, "order" = ? WHERE card_id = ?',
        (part_id, order, episode_id),
    )


def _exists(conn: sqlite3.Connection, table: str, column: str, value: Any) -> bool:
    return (
        conn.execute(f"SELECT 1 FROM {table} WHERE {column} = ?", (value,)).fetchone() is not None
    )


# Columns of type rows that point at other cards (or a worldline): emptied on restore when
# that target is gone, so the card keeps its type row.
TYPE_REFERENCES = {
    "character": (("origin_region_id", "card"),),
    "region": (("parent_region_id", "card"),),
    "part": (("main_id", "card"),),
    "episode": (("part_id", "card"), ("worldline_id", "worldline")),
}


def _without_missing(conn: sqlite3.Connection, table: str, row: dict[str, Any]) -> dict[str, Any]:
    fixed = dict(row)
    for column, target in TYPE_REFERENCES.get(table, ()):
        value = fixed.get(column)
        if value is not None and not _exists(conn, target, "id", value):
            fixed[column] = None
    return fixed


def _insert(conn: sqlite3.Connection, table: str, row: dict[str, Any]) -> bool:
    """Inserts a captured row at its old rowid (a new one if that was reused meanwhile);
    False when a card it points at is gone (FK fails)."""
    row = dict(row)
    if _exists(conn, table, "rowid", row["rowid"]):
        del row["rowid"]
    columns = ", ".join(f'"{c}"' for c in row)
    marks = ", ".join("?" for _ in row)
    conn.execute("SAVEPOINT restore_row")
    try:
        conn.execute(
            f"INSERT OR IGNORE INTO {table} ({columns}) VALUES ({marks})", tuple(row.values())
        )
    except sqlite3.IntegrityError:
        conn.execute("ROLLBACK TO restore_row")
        conn.execute("RELEASE restore_row")
        return False
    conn.execute("RELEASE restore_row")
    return True


def restore(conn: sqlite3.Connection, snap: Snapshot) -> None:
    """Puts back what capture() saw, inside the caller's transaction. Rows whose other end
    is gone meanwhile are skipped; cleared columns come back only where still empty."""
    for from_id, to_id in snap.added_links:
        conn.execute(
            "DELETE FROM episode_link WHERE from_id = ? AND to_id = ? AND kind = 'order'",
            (from_id, to_id),
        )
    for table, row in snap.rows:
        _insert(conn, table, _without_missing(conn, table, row) if table in TYPE_TABLES else row)
    for table, key, key_value, column, value in snap.nulled:
        if _exists(conn, "card", "id", value):
            conn.execute(
                f"UPDATE {table} SET {column} = ? WHERE {key} = ? AND {column} IS NULL",
                (value, key_value),
            )
    for episode_id, part_id, order in snap.moved:
        if part_id is None or _exists(conn, "card", "id", part_id):
            move_episode(conn, episode_id, part_id, order)


def touched_by(conn: sqlite3.Connection, snap: Snapshot) -> set[str]:
    """Card ids whose rows the delete or restore changed: for status (§14)."""
    ids: set[str] = set()
    for table, row in snap.rows:
        if table == "card":
            ids.add(row["id"])
        for column in RELATION_TABLES.get(table, ()):
            ids.add(row[column])
    ids |= {key for table, key_column, key, _, _ in snap.nulled if key_column == "card_id"}
    ids |= {episode_id for episode_id, _, _ in snap.moved}
    for from_id, to_id in snap.added_links:
        ids |= {from_id, to_id}
    existing = conn.execute(
        f"SELECT id FROM card WHERE id IN ({_marks(list(ids))})", tuple(ids)
    ).fetchall()
    return {row[0] for row in existing}
