"""SQL for snapshots (§14) and the copy they point at."""

import sqlite3
from pathlib import Path


def copy_database(conn: sqlite3.Connection, target: Path) -> None:
    """A consistent copy of the whole database at target (which must not exist yet)."""
    conn.execute("VACUUM INTO ?", (str(target),))


def insert(conn: sqlite3.Connection, work_id: str, stage: int, path: str, now: str) -> None:
    conn.execute(
        "INSERT INTO snapshot (work_id, stage, path, created_at) VALUES (?, ?, ?, ?)",
        (work_id, stage, path, now),
    )


def paths_of_work(conn: sqlite3.Connection, work_id: str) -> list[str]:
    rows = conn.execute("SELECT path FROM snapshot WHERE work_id = ? ORDER BY id", (work_id,))
    return [row[0] for row in rows]
