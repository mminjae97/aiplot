"""Writing beats (§10): the write role streams a beat's text by sentence, the server counts its
characters, writes it over when it holds a banned phrase, stores it as the beat's next version
and sets the next beat's target from what the chapter has left.

A chapter job writes the chapter's unwritten beats in order, so one that was stopped goes on
from the last stored beat; a beat job writes one beat again.
"""

import re
import sqlite3
from collections.abc import Sequence
from contextlib import aclosing
from dataclasses import dataclass
from pathlib import Path
from time import monotonic
from typing import Any

from aiplot.db import chapters as chapters_db
from aiplot.db.connection import connect, transaction
from aiplot.jobs.queue import JobContext, JobError, JobQueue
from aiplot.llm.client import LlmError
from aiplot.llm.router import Router
from aiplot.services import works, write_context

WRITING_STAGE = 3
# §10: a beat holding a banned phrase is written again up to this many times, then kept.
REGENERATIONS = 3
# The next beat's target follows what the chapter has left, within this much of its plan
# target (drafts until the step 7 length run).
TARGET_LOW = 0.5
TARGET_HIGH = 1.5
# A piece ends after a sentence mark with what closes it (more marks, closing quotes) or after
# a line break, and the spaces that follow: known once the next piece's first character
# arrived (possessive: a piece is never cut short of closers still to come). A quote after
# spaces opens the next sentence.
PIECE = re.compile(
    r"(.*?(?:[.?!…][.?!…\"'”’」』)]*+|\n)\s*+)(?=\S)",  # noqa: RUF001
    re.DOTALL,
)
LAST_END = re.compile(r".*[.?!…][.?!…\"'”’」』)]*", re.DOTALL)  # noqa: RUF001


class ChapterNotFoundError(LookupError):
    pass


class ChapterWrittenError(ValueError):
    """Every beat of the chapter has text: there is nothing left to generate."""


class SentenceBuffer:
    """Holds streamed text and gives it back in pieces ending after a sentence (§10); the
    pieces joined are the text as it arrived."""

    def __init__(self) -> None:
        self._held = ""

    def feed(self, text: str) -> list[str]:
        self._held += text
        pieces = []
        while (match := PIECE.match(self._held)) is not None:
            pieces.append(match.group(1))
            self._held = self._held[match.end() :]
        return pieces

    def flush(self) -> str:
        held, self._held = self._held, ""
        return held


def count_chars(text: str) -> int:
    """Characters incl. spaces (§6: counted in code); line breaks are not counted."""
    return len(text) - text.count("\n") - text.count("\r")


def next_target(chapter_target: int, written: int, remaining: Sequence[int]) -> int:
    """The next beat's target (§10): its share, by plan targets, of what the chapter has left
    for the beats still to write (the next one first), kept near its plan target."""
    plan = remaining[0]
    share = (chapter_target - written) * plan / sum(remaining)
    return max(1, round(min(max(share, plan * TARGET_LOW), plan * TARGET_HIGH)))


def complete(text: str, finish: str) -> str:
    """The beat's text as stored: trimmed, and when max_tokens cut it, up to its last whole
    sentence (all of it when there is none)."""
    text = text.strip()
    if finish != "length":
        return text
    whole = LAST_END.match(text)
    return whole.group(0) if whole else text


@dataclass(frozen=True)
class Written:
    version: int
    chars: int
    # Banned phrases still in the stored text after the regenerations.
    banned: tuple[str, ...]


async def stream_beat(
    router: Router, ctx: JobContext, beat_id: str, turns: list[Any]
) -> tuple[str, str]:
    """One generation of the beat: its pieces as `sentence` events, then (text, finish
    reason). `beat_start` tells the screen to start the beat's text from nothing."""
    ctx.emit("beat_start", {"beatId": beat_id})
    buffer = SentenceBuffer()
    parts: list[str] = []
    finish = "stop"
    async with aclosing(router.stream("write", turns)) as deltas:
        async for delta in deltas:
            if delta.kind == "content":
                parts.append(delta.text)
                for piece in buffer.feed(delta.text):
                    ctx.emit("sentence", {"beatId": beat_id, "text": piece})
            elif delta.kind == "finish":
                finish = delta.text
    rest = buffer.flush()
    if rest:
        ctx.emit("sentence", {"beatId": beat_id, "text": rest})
    return "".join(parts), finish


def store(
    conn: sqlite3.Connection, router: Router, work_id: str, beat_id: str, text: str
) -> tuple[int, int]:
    """The text as the beat's next version (version, chars), checked again: the stage may have
    been reopened while the role wrote."""
    meta = router.meta("write")
    chars = count_chars(text)
    with transaction(conn):
        works.require_current(conn, work_id, WRITING_STAGE)
        if chapters_db.chapter_of_beat(conn, beat_id) is None:
            raise write_context.BeatNotFoundError(beat_id)
        version = chapters_db.insert_version(
            conn,
            beat_id,
            text,
            chars,
            "generated",
            meta.prompt_version,
            meta.style_id,
            meta.style_version,
            works.now(),
        )
    return version, chars


async def write_beat(
    router: Router,
    conn: sqlite3.Connection,
    ctx: JobContext,
    work_id: str,
    beat_id: str,
    target_chars: int,
) -> Written:
    """Writes the beat and stores it. A text holding a banned phrase (or none at all) is
    written again up to REGENERATIONS times; the last one is kept, unless it is empty."""
    style = router.style("write")
    if style is None:
        raise LlmError("ROLE_NOT_CONFIGURED", "the write role has no style framework")
    turns = write_context.write_turns(conn, style, beat_id, target_chars=target_chars)
    text = ""
    banned: list[str] = []
    for _ in range(1 + REGENERATIONS):
        text = complete(*await stream_beat(router, ctx, beat_id, turns))
        banned = style.banned_in(text)
        if text and not banned:
            break
    if not text:
        raise LlmError("LLM_INVALID_OUTPUT", "write: the beat came back empty")
    version, chars = store(conn, router, work_id, beat_id, text)
    ctx.emit("beat_done", {"beatId": beat_id, "chars": chars, "version": version})
    return Written(version, chars, tuple(banned))


# Job error codes for what a writing job can meet after it was accepted (§16).
REFUSALS: dict[type[Exception], str] = {
    works.WorkNotFoundError: "WORK_NOT_FOUND",
    works.StageLockedError: "STAGE_LOCKED",
    works.StageNotStartedError: "STAGE_NOT_STARTED",
    ChapterNotFoundError: "CHAPTER_NOT_FOUND",
    write_context.BeatNotFoundError: "BEAT_NOT_FOUND",
}


FAILURES: tuple[type[Exception], ...] = (LlmError, *REFUSALS)


def job_error(exc: Exception) -> JobError:
    if isinstance(exc, LlmError):
        return JobError(exc.code, str(exc))
    code = next(code for kind, code in REFUSALS.items() if isinstance(exc, kind))
    return JobError(code, str(exc))


def chapter_to_write(conn: sqlite3.Connection, chapter_id: str) -> chapters_db.ChapterRow:
    """The chapter, if a job may write it now: writing is the current stage and a beat of it
    has no text yet."""
    chapter = chapters_db.get_chapter(conn, chapter_id)
    if chapter is None:
        raise ChapterNotFoundError(chapter_id)
    works.require_current(conn, chapter.work_id, WRITING_STAGE)
    written = chapters_db.current_chars(conn, chapter_id)
    if all(beat.id in written for beat in chapters_db.beats_of(conn, chapter_id)):
        raise ChapterWrittenError(f"every beat of {chapter_id} is written")
    return chapter


def beat_to_write(conn: sqlite3.Connection, beat_id: str) -> chapters_db.ChapterRow:
    """The beat's chapter, if a job may write the beat now."""
    chapter_id = chapters_db.chapter_of_beat(conn, beat_id)
    chapter = chapters_db.get_chapter(conn, chapter_id) if chapter_id else None
    if chapter is None:
        raise write_context.BeatNotFoundError(beat_id)
    works.require_current(conn, chapter.work_id, WRITING_STAGE)
    return chapter


def start_chapter(router: Router, jobs: JobQueue, db_path: Path, chapter_id: str) -> str:
    """Submits the chapter's job (POST /chapters/{chapterId}/generate): the chapter's job
    already running answers instead. It writes the beats without text in order, pausing only
    between beats, and ends with {chars, warnings, elapsedSec}."""
    conn = connect(db_path)
    try:
        work_id = chapter_to_write(conn, chapter_id).work_id
    finally:
        conn.close()

    async def run(ctx: JobContext) -> dict[str, Any]:
        started = monotonic()
        kept_banned = 0
        conn = connect(db_path)
        try:
            while True:
                await ctx.checkpoint()
                chapter = chapters_db.get_chapter(conn, chapter_id)
                if chapter is None:
                    raise ChapterNotFoundError(chapter_id)
                beats = chapters_db.beats_of(conn, chapter_id)
                written = chapters_db.current_chars(conn, chapter_id)
                todo = [beat for beat in beats if beat.id not in written]
                chars = sum(written.values())
                ctx.progress(len(beats) - len(todo), len(beats), "write")
                if not todo:
                    break
                target = next_target(
                    chapter.target_chars, chars, [beat.target_chars for beat in todo]
                )
                done = await write_beat(router, conn, ctx, work_id, todo[0].id, target)
                kept_banned += bool(done.banned)
            return {
                "chars": chars,
                "warnings": kept_banned,
                "elapsedSec": round(monotonic() - started, 1),
            }
        except FAILURES as exc:
            raise job_error(exc) from exc
        finally:
            conn.close()

    job = jobs.submit("chapter", run, work_id=work_id, key=f"chapter:{chapter_id}")
    return job.id


def start_beat(router: Router, jobs: JobQueue, db_path: Path, beat_id: str) -> str:
    """Submits the beat's job (POST /beats/{beatId}/regenerate): the beat's job already running
    answers instead. It writes the beat again at its plan target as a new version and ends
    with {chars, warnings, elapsedSec} (chars = the beat's)."""
    conn = connect(db_path)
    try:
        work_id = beat_to_write(conn, beat_id).work_id
    finally:
        conn.close()

    async def run(ctx: JobContext) -> dict[str, Any]:
        started = monotonic()
        conn = connect(db_path)
        try:
            ctx.progress(0, 1, "write")
            chapter = beat_to_write(conn, beat_id)
            beat = next(b for b in chapters_db.beats_of(conn, chapter.id) if b.id == beat_id)
            done = await write_beat(router, conn, ctx, work_id, beat_id, beat.target_chars)
            ctx.progress(1, 1, "write")
            return {
                "chars": done.chars,
                "warnings": int(bool(done.banned)),
                "elapsedSec": round(monotonic() - started, 1),
            }
        except FAILURES as exc:
            raise job_error(exc) from exc
        finally:
            conn.close()

    job = jobs.submit("beat", run, work_id=work_id, key=f"beat:{beat_id}")
    return job.id
