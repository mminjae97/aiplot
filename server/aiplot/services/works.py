"""Books in the library (§12 S0): create, list, open, rename and decorate, delete."""

import logging
import secrets
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from aiplot.db import covers as covers_db
from aiplot.db import works as db
from aiplot.db.connection import transaction
from aiplot.generated.works.work import Work
from aiplot.generated.works.work_update import WorkUpdate

TITLE_MAX = 100

logger = logging.getLogger(__name__)


class WorkNotFoundError(LookupError):
    pass


class CoverNotFoundError(LookupError):
    pass


class StageLockedError(PermissionError):
    """The stage is read-only once a later one started (§1, §11): 423 STAGE_LOCKED."""


class TitleEmptyError(ValueError):
    pass


class TitleTooLongError(ValueError):
    pass


def now() -> str:
    # Milliseconds keep "most recent first" stable for books made in the same second.
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def clean_title(title: str) -> str:
    clean = " ".join(title.split())
    if not clean:
        raise TitleEmptyError("title is blank")
    if len(clean) > TITLE_MAX:
        raise TitleTooLongError(f"title is over {TITLE_MAX} chars")
    return clean


def create(conn: sqlite3.Connection, title: str) -> Work:
    return db.insert(conn, f"w_{secrets.token_hex(8)}", clean_title(title), now())


def list_recent(conn: sqlite3.Connection) -> list[Work]:
    return db.list_recent(conn)


def get(conn: sqlite3.Connection, work_id: str) -> Work | None:
    return db.get(conn, work_id)


def update(conn: sqlite3.Connection, work_id: str, update: WorkUpdate) -> Work:
    """Applies the keys the request sent; updated_at stays, so the book keeps its place."""
    sent = update.model_fields_set
    title = None if update.title is None else clean_title(update.title)
    with transaction(conn):
        if db.get(conn, work_id) is None:
            raise WorkNotFoundError(work_id)
        if title is not None:
            db.set_title(conn, work_id, title)
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


def delete(conn: sqlite3.Connection, images_dir: Path, work_id: str) -> None:
    """Deletes the book with everything that belongs to it: rows cascade from work, then its
    cover files go."""
    with transaction(conn):
        if db.get(conn, work_id) is None:
            raise WorkNotFoundError(work_id)
        files = covers_db.paths_of_work(conn, work_id)
        db.delete(conn, work_id)
    for relative in files:
        try:
            (images_dir / relative).unlink(missing_ok=True)
        except OSError:
            # The book is gone; only a stray file is left.
            logger.warning("could not remove cover file %s", relative, exc_info=True)


def require_open(conn: sqlite3.Connection, work_id: str, stage: int) -> Work:
    """The work, if data of this stage may still change."""
    work = db.get(conn, work_id)
    if work is None:
        raise WorkNotFoundError(work_id)
    if work.locked_stage >= stage:
        raise StageLockedError(f"stage {stage} of {work_id} is locked")
    return work
