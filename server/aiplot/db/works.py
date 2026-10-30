"""SQL for the work table."""

import sqlite3

from aiplot.generated.works.work import Work

COLUMNS = "id, title, stage, locked_stage, last_item, updated_at"


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
