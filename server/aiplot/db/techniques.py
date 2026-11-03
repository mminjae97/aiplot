"""SQL for the technique tables (§14): the shared catalog, replaced from the data files."""

import sqlite3

from aiplot.generated.technique.technique import Technique


def replace_all(conn: sqlite3.Connection, techniques: list[Technique]) -> None:
    """Make the tables hold exactly these techniques (call inside a transaction). Rows of
    techniques still in the catalog are updated in place, so references to them survive."""
    keep = [t.id for t in techniques]
    marks = ", ".join("?" for _ in keep)
    conn.execute(f"DELETE FROM technique_card WHERE id NOT IN ({marks})", keep)
    conn.execute("DELETE FROM technique_tag")
    conn.execute("DELETE FROM technique_relation")
    conn.executemany(
        "INSERT INTO technique_card (id, category, name, data) VALUES (?, ?, ?, ?) "
        "ON CONFLICT (id) DO UPDATE SET "
        "category = excluded.category, name = excluded.name, data = excluded.data",
        [(t.id, t.category, t.name, t.model_dump_json()) for t in techniques],
    )
    conn.executemany(
        "INSERT INTO technique_tag (technique_id, kind, tag) VALUES (?, ?, ?)",
        [
            (t.id, kind, tag)
            for t in techniques
            for kind, tags in (
                ("scope", t.scope),
                ("effect", t.effects),
                ("situation", t.situations),
            )
            for tag in dict.fromkeys(tags)
        ],
    )
    pairs = {(t.id, other) for t in techniques for other in t.pairs_with}
    conflicts = {
        edge
        for t in techniques
        for other in t.conflicts_with
        for edge in ((t.id, other), (other, t.id))
    }
    conn.executemany(
        "INSERT INTO technique_relation (from_id, to_id, kind) VALUES (?, ?, ?)",
        [(a, b, "pairs") for a, b in sorted(pairs)]
        + [(a, b, "conflicts") for a, b in sorted(conflicts)],
    )


def list_all(conn: sqlite3.Connection) -> list[Technique]:
    rows = conn.execute("SELECT data FROM technique_card ORDER BY id").fetchall()
    return [Technique.model_validate_json(row["data"]) for row in rows]


def get(conn: sqlite3.Connection, technique_id: str) -> Technique | None:
    row = conn.execute("SELECT data FROM technique_card WHERE id = ?", (technique_id,)).fetchone()
    return Technique.model_validate_json(row["data"]) if row else None
