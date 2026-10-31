"""SQL for the work table."""

import sqlite3

from aiplot.generated.works.work import Work

COLUMNS = "id, title, stage, locked_stage, last_item, color, cover_id, updated_at"


def to_work(row: sqlite3.Row) -> Work:
    return Work.model_validate(dict(row))


def insert(conn: sqlite3.Connection, work_id: str, title: str, now: str) -> Work:
    conn.execute("INSERT INTO work (id, title, updated_at) VALUES (?, ?, ?)", (work_id, title, now))
    work = get(conn, work_id)
    assert work is not None
    return work


def get(conn: sqlite3.Connection, work_id: str) -> Work | None:
    row = conn.execute(f"SELECT {COLUMNS} FROM work WHERE id = ?", (work_id,)).fetchone()
    return to_work(row) if row else None


def list_recent(conn: sqlite3.Connection) -> list[Work]:
    rows = conn.execute(
        f"SELECT {COLUMNS} FROM work ORDER BY updated_at DESC, rowid DESC"
    ).fetchall()
    return [to_work(row) for row in rows]


def set_color(conn: sqlite3.Connection, work_id: str, color: str | None) -> None:
    conn.execute("UPDATE work SET color = ? WHERE id = ?", (color, work_id))


def set_cover(conn: sqlite3.Connection, work_id: str, cover_id: str | None) -> None:
    conn.execute("UPDATE work SET cover_id = ? WHERE id = ?", (cover_id, work_id))


def set_title(conn: sqlite3.Connection, work_id: str, title: str) -> None:
    conn.execute("UPDATE work SET title = ? WHERE id = ?", (title, work_id))


def delete(conn: sqlite3.Connection, work_id: str) -> None:
    # Its rows in other tables go with it (ON DELETE CASCADE).
    conn.execute("DELETE FROM work WHERE id = ?", (work_id,))
