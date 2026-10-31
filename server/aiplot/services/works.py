"""Books in the library (§12 S0): create, list, open, decorate."""

import secrets
import sqlite3
from datetime import UTC, datetime

from aiplot.db import covers as covers_db
from aiplot.db import works as db
from aiplot.db.connection import transaction
from aiplot.generated.works.work import Work
from aiplot.generated.works.work_update import WorkUpdate

TITLE_MAX = 100


class WorkNotFoundError(LookupError):
    pass


class CoverNotFoundError(LookupError):
    pass


class TitleEmptyError(ValueError):
    pass


class TitleTooLongError(ValueError):
    pass


def now() -> str:
    # Milliseconds keep "most recent first" stable for books made in the same second.
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def create(conn: sqlite3.Connection, title: str) -> Work:
    clean = " ".join(title.split())
    if not clean:
        raise TitleEmptyError("title is blank")
    if len(clean) > TITLE_MAX:
        raise TitleTooLongError(f"title is over {TITLE_MAX} chars")
    return db.insert(conn, f"w_{secrets.token_hex(8)}", clean, now())


def list_recent(conn: sqlite3.Connection) -> list[Work]:
    return db.list_recent(conn)


def get(conn: sqlite3.Connection, work_id: str) -> Work | None:
    return db.get(conn, work_id)


def decorate(conn: sqlite3.Connection, work_id: str, update: WorkUpdate) -> Work:
    """Applies the keys the request sent; updated_at stays, so the book keeps its place."""
    with transaction(conn):
        if db.get(conn, work_id) is None:
            raise WorkNotFoundError(work_id)
        sent = update.model_fields_set
        if "color" in sent:
            db.set_color(conn, work_id, update.color)
        if "cover_id" in sent:
            cover_id = update.cover_id
            if cover_id is not None and covers_db.path_of(conn, work_id, cover_id) is None:
                raise CoverNotFoundError(cover_id)
            db.set_cover(conn, work_id, update.cover_id)
    work = db.get(conn, work_id)
    assert work is not None
    return work
