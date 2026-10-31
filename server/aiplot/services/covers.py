"""Cover illustrations of a book (§12 책 꾸미기): upload, list, serve, delete.

The app crops every upload to portrait 1:1.5 and encodes it as WebP, so the server only checks
the format and size. Files live in {data}/images/covers and belong to their book.
"""

import logging
import secrets
import sqlite3
from pathlib import Path

from aiplot.db import covers as db
from aiplot.db import works as works_db
from aiplot.generated.works.cover import Cover
from aiplot.services.works import CoverNotFoundError, WorkNotFoundError, now

MAX_BYTES = 5 * 1024 * 1024

logger = logging.getLogger(__name__)


class CoverTooLargeError(ValueError):
    pass


class CoverUnsupportedError(ValueError):
    pass


def is_webp(data: bytes) -> bool:
    return len(data) > 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"


def require_work(conn: sqlite3.Connection, work_id: str) -> None:
    if works_db.get(conn, work_id) is None:
        raise WorkNotFoundError(work_id)


def add(conn: sqlite3.Connection, images_dir: Path, work_id: str, data: bytes) -> Cover:
    require_work(conn, work_id)
    if len(data) > MAX_BYTES:
        raise CoverTooLargeError(f"cover is over {MAX_BYTES} bytes")
    if not is_webp(data):
        raise CoverUnsupportedError("cover is not WebP")
    cover_id = f"cv_{secrets.token_hex(8)}"
    relative = f"covers/{cover_id}.webp"
    path = images_dir / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(".part")
    try:
        partial.write_bytes(data)
        partial.replace(path)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise
    try:
        return db.insert(conn, cover_id, work_id, relative, now())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def list_for_work(conn: sqlite3.Connection, work_id: str) -> list[Cover]:
    require_work(conn, work_id)
    return db.list_for_work(conn, work_id)


def file_of(conn: sqlite3.Connection, images_dir: Path, work_id: str, cover_id: str) -> Path:
    relative = db.path_of(conn, work_id, cover_id)
    if relative is None:
        raise CoverNotFoundError(cover_id)
    path = images_dir / relative
    if not path.is_file():
        raise CoverNotFoundError(cover_id)
    return path


def delete(conn: sqlite3.Connection, images_dir: Path, work_id: str, cover_id: str) -> None:
    """Deleting the cover in use turns the book back to its cloth cover."""
    relative = db.path_of(conn, work_id, cover_id)
    if relative is None:
        raise CoverNotFoundError(cover_id)
    db.delete(conn, cover_id)
    try:
        (images_dir / relative).unlink(missing_ok=True)
    except OSError:
        # The row is gone, so the book no longer shows it; only a stray file is left.
        logger.warning("could not remove cover file %s", relative, exc_info=True)
