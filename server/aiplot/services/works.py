"""Books in the library (§12 S0): create, list, open."""

import secrets
import sqlite3
from datetime import UTC, datetime

from aiplot.db import works as db
from aiplot.generated.works.work import Work


class TitleEmptyError(ValueError):
    pass


def now() -> str:
    # Milliseconds keep "most recent first" stable for books made in the same second.
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def create(conn: sqlite3.Connection, title: str) -> Work:
    clean = " ".join(title.split())
    if not clean:
        raise TitleEmptyError("title is blank")
    return db.insert(conn, f"w_{secrets.token_hex(8)}", clean, now())


def list_recent(conn: sqlite3.Connection) -> list[Work]:
    return db.list_recent(conn)


def get(conn: sqlite3.Connection, work_id: str) -> Work | None:
    return db.get(conn, work_id)
