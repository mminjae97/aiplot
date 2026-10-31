"""SQL for the work_cover table."""

import sqlite3

from aiplot.generated.works.cover import Cover

COLUMNS = "id, work_id, created_at"


def to_cover(row: sqlite3.Row) -> Cover:
    return Cover.model_validate(dict(row))


def insert(conn: sqlite3.Connection, cover_id: str, work_id: str, path: str, now: str) -> Cover:
    conn.execute(
        "INSERT INTO work_cover (id, work_id, path, created_at) VALUES (?, ?, ?, ?)",
        (cover_id, work_id, path, now),
    )
    return Cover(id=cover_id, work_id=work_id, created_at=now)


def list_for_work(conn: sqlite3.Connection, work_id: str) -> list[Cover]:
    rows = conn.execute(
        f"SELECT {COLUMNS} FROM work_cover WHERE work_id = ? ORDER BY created_at, rowid",
        (work_id,),
    ).fetchall()
    return [to_cover(row) for row in rows]


def path_of(conn: sqlite3.Connection, work_id: str, cover_id: str) -> str | None:
    """Path relative to the images dir, or None when the work has no such cover."""
    row = conn.execute(
        "SELECT path FROM work_cover WHERE id = ? AND work_id = ?", (cover_id, work_id)
    ).fetchone()
    return str(row["path"]) if row else None


def paths_of_work(conn: sqlite3.Connection, work_id: str) -> list[str]:
    rows = conn.execute("SELECT path FROM work_cover WHERE work_id = ?", (work_id,)).fetchall()
    return [str(row["path"]) for row in rows]


def delete(conn: sqlite3.Connection, cover_id: str) -> None:
    # work.cover_id pointing here falls back to NULL (ON DELETE SET NULL).
    conn.execute("DELETE FROM work_cover WHERE id = ?", (cover_id,))
