"""Writing beats (§10): the write role streams a beat's text by sentence, the server counts its
characters, writes it over when it holds a banned phrase, stores it as the beat's next version,
has it checked (state records and warnings) and sets the next beat's target from what the
chapter has left.

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
from aiplot.llm.style import Style
from aiplot.services import checks, summaries, works, write_context
from aiplot.services.write_context import count_chars

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

LINE_END_SPACES = re.compile(r"[ \t]+$", re.MULTILINE)
BLANK_LINES = re.compile(r"\n{3,}")

# §10: a beat that came short of this much of its target is continued, up to this many times
# (drafts: step 7 runs 1-6, the model ends a call at ~400 chars whatever the target).
CONTINUE_BELOW = 0.9
CONTINUATIONS = 3
# What joins a continuation to the beat's text: a new paragraph.
JOIN = "\n\n"


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


def new_lines(more: str, text: str) -> str:
    """more without the lines text already holds word for word: a continuation that starts the
    beat over leaves nothing (a short line said twice on purpose goes with them)."""
    held = {line.strip() for line in text.splitlines()}
    kept = [line for line in more.splitlines() if not line.strip() or line.strip() not in held]
    return BLANK_LINES.sub("\n\n", "\n".join(kept)).strip()


def next_target(chapter_target: int, written: int, remaining: Sequence[int]) -> int:
    """The next beat's target (§10): its share, by plan targets, of what the chapter has left
    for the beats still to write (the next one first), kept near its plan target."""
    plan = remaining[0]
    share = (chapter_target - written) * plan / sum(remaining)
    return max(1, round(min(max(share, plan * TARGET_LOW), plan * TARGET_HIGH)))


def complete(text: str, finish: str) -> str:
    """The beat's text as stored: trimmed, no spaces left at a line's end (the model's Markdown
    line breaks), and when max_tokens cut it, up to its last whole sentence (all of it when
    there is none)."""
    text = LINE_END_SPACES.sub("", text).strip()
    if finish != "length":
        return text
    whole = LAST_END.match(text)
    return whole.group(0) if whole else text


@dataclass(frozen=True)
class Written:
    version: int
    chars: int
    # The warnings on the stored version: the check's, and one per banned phrase still in the
    # text after the regenerations.
    warnings: int


def show(ctx: JobContext, beat_id: str, text: str) -> None:
    """The beat's text on the screen again from nothing: what was streamed is not what is kept."""
    ctx.emit("beat_start", {"beatId": beat_id})
    buffer = SentenceBuffer()
    for piece in [*buffer.feed(text), buffer.flush()]:
        if piece:
            ctx.emit("sentence", {"beatId": beat_id, "text": piece})


async def stream_beat(
    router: Router, ctx: JobContext, beat_id: str, turns: list[Any], *, continued: bool = False
) -> tuple[str, str]:
    """One generation of the beat: its pieces as `sentence` events, then (text, finish
    reason). `beat_start` tells the screen to start the beat's text from nothing; a
    continuation goes on in a new paragraph after what the screen has."""
    buffer = SentenceBuffer()
    if continued:
        buffer.feed(JOIN)
    else:
        ctx.emit("beat_start", {"beatId": beat_id})
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
    conn: sqlite3.Connection,
    router: Router,
    work_id: str,
    beat_id: str,
    text: str,
    banned: Sequence[str] = (),
) -> tuple[int, int, list[str]]:
    """The text as the beat's next version (version, chars, the ids of its banned-phrase
    warnings), checked again: the stage may have been reopened while the role wrote. With it
    the state records of the beat's text before go, and each banned phrase kept in the text
    becomes a warning, whatever becomes of the check."""
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
        warned = checks.begin(conn, beat_id, version, banned)
    return version, chars, warned


async def continued(
    router: Router,
    conn: sqlite3.Connection,
    ctx: JobContext,
    style: Style,
    beat_id: str,
    target_chars: int,
    text: str,
    story: Sequence[str],
    state: Sequence[str],
) -> str:
    """The beat's text, continued while it is short of its target (§10): each call is asked for
    what is still missing and goes on from the text's end. Lines the beat already has are
    dropped from what it adds; a continuation that adds nothing, holds a banned phrase or was
    cut at max_tokens (a loop) is not kept and ends it."""
    for _ in range(CONTINUATIONS):
        chars = count_chars(text)
        if chars >= target_chars * CONTINUE_BELOW:
            break
        missing = target_chars - chars
        turns = write_context.write_turns(
            conn, style, beat_id, target_chars=missing, summaries=story, state=state, begun=text
        )
        arrived, finish = await stream_beat(router, ctx, beat_id, turns, continued=True)
        more = complete(arrived, finish)
        kept = "" if finish == "length" else new_lines(more, text)
        if style.banned_in(kept):
            kept = ""
        if kept:
            text = f"{text}{JOIN}{kept}"
        if kept != more or not kept:
            show(ctx, beat_id, text)
        if not kept:
            break
    return text


async def write_beat(
    router: Router,
    conn: sqlite3.Connection,
    ctx: JobContext,
    work_id: str,
    beat_id: str,
    target_chars: int,
) -> Written:
    """Writes the beat and stores it. A text holding a banned phrase (or none at all) is
    written again up to REGENERATIONS times; the last one is kept, unless it is empty. A clean
    text that came short is continued. The stored text is then checked (state and warnings) and
    the chapter's summaries are made again (§10)."""
    style = router.style("write")
    if style is None:
        raise LlmError("ROLE_NOT_CONFIGURED", "the write role has no style framework")
    chapter_id = chapters_db.chapter_of_beat(conn, beat_id)
    if chapter_id is None:
        raise write_context.BeatNotFoundError(beat_id)
    story = summaries.story_so_far(conn, chapter_id)
    state = checks.state_for_beat(conn, beat_id)
    turns = write_context.write_turns(
        conn, style, beat_id, target_chars=target_chars, summaries=story, state=state
    )
    text = finish = ""
    banned: list[str] = []
    for _ in range(1 + REGENERATIONS):
        arrived, finish = await stream_beat(router, ctx, beat_id, turns)
        text = complete(arrived, finish)
        banned = style.banned_in(text)
        if text and not banned:
            break
    if not text:
        raise LlmError("LLM_INVALID_OUTPUT", "write: the beat came back empty")
    if not banned and finish != "length":
        text = await continued(router, conn, ctx, style, beat_id, target_chars, text, story, state)
    version, chars, warned = store(conn, router, work_id, beat_id, text, banned)
    ctx.emit("beat_done", {"beatId": beat_id, "chars": chars, "version": version})
    for warning_id in warned:
        ctx.emit("warning", {"warningId": warning_id, "beatId": beat_id, "kind": "banned_phrase"})
    # The beat is stored whatever becomes of its check and its chapter's summaries.
    warnings = await checks.check_beat(
        router, conn, ctx, work_id, beat_id, version, text, len(warned)
    )
    await summaries.summarize_chapter(router, conn, chapter_id)
    return Written(version, chars, warnings)


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
        warnings = 0
        conn = connect(db_path)
        try:
            await summaries.catch_up(router, conn, chapter_id)
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
                warnings += done.warnings
            return {
                "chars": chars,
                "warnings": warnings,
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
                "warnings": done.warnings,
                "elapsedSec": round(monotonic() - started, 1),
            }
        except FAILURES as exc:
            raise job_error(exc) from exc
        finally:
            conn.close()

    job = jobs.submit("beat", run, work_id=work_id, key=f"beat:{beat_id}")
    return job.id
