"""The user's own changes to the manuscript (§10, §16): a beat's text saved by hand or put back
to an earlier version becomes its next version (origin edited), and a job then checks the beat
again and redoes its chapter's summaries.
"""

import sqlite3
from pathlib import Path
from time import monotonic
from typing import Any

from aiplot.db import chapters as chapters_db
from aiplot.db.connection import connect, transaction
from aiplot.generated.writing.beat_version import BeatVersion
from aiplot.generated.writing.chapter_text import ChapterText
from aiplot.jobs.queue import TERMINAL, JobContext, JobQueue
from aiplot.llm.router import Router
from aiplot.services import checks, summaries, works, writing
from aiplot.services.write_context import BeatNotFoundError, count_chars


class TextEmptyError(ValueError):
    pass


class BeatBusyError(RuntimeError):
    """A job is writing the beat or its chapter: its text may not change under it."""


class VersionNotFoundError(LookupError):
    pass


def chapter_text(conn: sqlite3.Connection, chapter_id: str) -> ChapterText:
    found = chapters_db.chapter_text(conn, chapter_id)
    if found is None:
        raise writing.ChapterNotFoundError(chapter_id)
    return found


def versions(conn: sqlite3.Connection, beat_id: str) -> list[BeatVersion]:
    if chapters_db.chapter_of_beat(conn, beat_id) is None:
        raise BeatNotFoundError(beat_id)
    return chapters_db.versions_of(conn, beat_id)


def save(
    conn: sqlite3.Connection, jobs: JobQueue, beat_id: str, text: str
) -> tuple[BeatVersion, str, bool]:
    """Stores the text as the beat's next version (the version, its work, whether a check is
    owed): the same text as the current version stores nothing, and owes a check only if that
    version was never checked (its job failed or was stopped). A beat without text yet may be
    written by hand so. Refused while writing is not the current stage, while a job writes the
    beat or its chapter, and for a blank text. The state records of the beat's text before go
    with it (§7)."""
    chapter = writing.beat_to_write(conn, beat_id)
    writing_it = (f"chapter:{chapter.id}", f"beat:{beat_id}")
    if any(
        job.key in writing_it and job.status not in TERMINAL
        for job in jobs.for_work(chapter.work_id)
    ):
        raise BeatBusyError(f"{beat_id} is being written")
    # As a generated text is stored: trimmed, no spaces left at a line's end.
    text = writing.complete(text.replace("\r\n", "\n").replace("\r", "\n"), "stop")
    if not text:
        raise TextEmptyError("a beat's text may not be blank")
    with transaction(conn):
        works.require_current(conn, chapter.work_id, writing.WRITING_STAGE)
        current = chapters_db.current_version(conn, beat_id)
        if current is not None and current.text == text:
            return current, chapter.work_id, not current.checked
        number = chapters_db.insert_version(
            conn, beat_id, text, count_chars(text), "edited", None, None, None, works.now()
        )
        checks.begin(conn, beat_id, number, ())
    stored = chapters_db.get_version(conn, beat_id, number)
    assert stored is not None
    return stored, chapter.work_id, True


def restore(
    conn: sqlite3.Connection, jobs: JobQueue, beat_id: str, version: int
) -> tuple[BeatVersion, str, bool]:
    """Puts the beat back to an earlier version's text, as its next version."""
    if chapters_db.chapter_of_beat(conn, beat_id) is None:
        raise BeatNotFoundError(beat_id)
    old = chapters_db.get_version(conn, beat_id, version)
    if old is None:
        raise VersionNotFoundError(f"{beat_id} has no version {version}")
    return save(conn, jobs, beat_id, old.text)


def start_recheck(
    router: Router, jobs: JobQueue, db_path: Path, work_id: str, beat_id: str, version: int
) -> str:
    """Submits the job that follows a saved version (§10): the beat checked again (state and
    warnings) and its chapter's summaries redone. A job whose version is no longer the current
    one when it starts does nothing: the newer version's job does it; one overtaken while it
    runs stores nothing of its check or summaries. Ends with {warnings, elapsedSec}."""

    async def run(ctx: JobContext) -> dict[str, Any]:
        started = monotonic()
        warnings = 0
        conn = connect(db_path)
        try:
            ctx.progress(0, 2, "check")
            chapter = writing.beat_to_write(conn, beat_id)
            current = chapters_db.current_version(conn, beat_id)
            if current is not None and current.version == version:
                warnings = await checks.check_beat(
                    router, conn, ctx, work_id, beat_id, version, current.text
                )
                ctx.progress(1, 2, "summary")
                await summaries.summarize_chapter(router, conn, chapter.id)
            ctx.progress(2, 2, "summary")
            return {"warnings": warnings, "elapsedSec": round(monotonic() - started, 1)}
        except writing.FAILURES as exc:
            raise writing.job_error(exc) from exc
        finally:
            conn.close()

    job = jobs.submit("recheck", run, work_id=work_id, key=f"recheck:{beat_id}:{version}")
    return job.id
