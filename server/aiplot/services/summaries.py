"""Summaries of the manuscript (§10): what the write role is told of the story so far.

After a beat is stored its chapter is summarized again from its current text: while beats are
still to write, the chapter's progress; once all are written, a long and a short summary of the
chapter, and when that completes its episode, the episode's summary from its chapters' long
ones. A beat's context then holds, oldest first: earlier episodes (their summary, else their
chapters' short ones), the earlier chapters of its episode (short), the chapter just before
(long), and its own chapter's progress.

The texts here are model input, not UI text: they follow prompts/summary.
"""

import re
import sqlite3
from contextlib import aclosing
from typing import Literal

from aiplot.db import chapters as chapters_db
from aiplot.db.connection import transaction
from aiplot.llm.client import LlmError, Message
from aiplot.llm.router import Router
from aiplot.services import works
from aiplot.services.draft_context import block

Kind = Literal["progress", "long", "short", "episode"]

WRITING_STAGE = 3
# §10: what each summary is asked to be, in chars (the model cannot count: about).
TARGET_CHARS: dict[Kind, int] = {"progress": 400, "long": 1000, "short": 200, "episode": 300}
LABEL: dict[Kind, str] = {
    "progress": "쓰고 있는 화의 지금까지",
    "long": "다 쓴 화 (긴 요약)",
    "short": "다 쓴 화 (짧은 요약)",
    "episode": "에피소드 전체 (화 요약들을 하나로)",
}
# An empty summary is asked for once more.
ATTEMPTS = 2
# A sentence's end with what closes it: a summary cut at max_tokens is kept up to the last one.
LAST_END = re.compile(r".*[.?!…][.?!…\"'”’」』)]*", re.DOTALL)  # noqa: RUF001


async def summarize(router: Router, kind: Kind, text: str) -> str:
    """The summary role's summary of the text."""
    order = f"종류: {LABEL[kind]}\n분량: 공백 포함 {TARGET_CHARS[kind]}자 안팎"
    turns: list[Message] = [
        {"role": "user", "content": f"{block('원문', text)}\n\n{block('지시', order)}"}
    ]
    for _ in range(ATTEMPTS):
        parts: list[str] = []
        finish = "stop"
        async with aclosing(router.stream("summary", turns)) as deltas:
            async for delta in deltas:
                if delta.kind == "content":
                    parts.append(delta.text)
                elif delta.kind == "finish":
                    finish = delta.text
        summary = " ".join("".join(parts).split())
        if finish == "length":
            whole = LAST_END.match(summary)
            summary = whole.group(0) if whole else summary
        if summary:
            return summary
    raise LlmError("LLM_INVALID_OUTPUT", f"summary: the {kind} summary came back empty")


async def summarize_chapter(router: Router, conn: sqlite3.Connection, chapter_id: str) -> None:
    """The chapter's summaries made again from its current text (after a beat was stored)."""
    chapter = chapters_db.get_chapter(conn, chapter_id)
    if chapter is None:
        return
    texts = chapters_db.current_texts(conn, chapter_id)
    beats = chapters_db.beats_of(conn, chapter_id)
    written = "\n\n".join(texts[beat.id] for beat in beats if beat.id in texts)
    if not written:
        return
    if any(beat.id not in texts for beat in beats):
        progress = await summarize(router, "progress", written)
        with transaction(conn):
            works.require_current(conn, chapter.work_id, WRITING_STAGE)
            chapters_db.set_progress(conn, chapter_id, progress)
            chapters_db.set_episode_summary(conn, chapter.episode_id, None)
        return
    long = await summarize(router, "long", written)
    short = await summarize(router, "short", written)
    with transaction(conn):
        works.require_current(conn, chapter.work_id, WRITING_STAGE)
        chapters_db.set_end_summaries(conn, chapter_id, long, short)
    # The episode's, once each of its chapters is written to its end.
    of_episode = chapters_db.chapters_of_plan(conn, chapter.plan_id)
    if any(row.long is None for row in of_episode):
        return
    whole = "\n\n".join(f"{row.number}화: {row.long}" for row in of_episode)
    summary = await summarize(router, "episode", whole)
    with transaction(conn):
        works.require_current(conn, chapter.work_id, WRITING_STAGE)
        chapters_db.set_episode_summary(conn, chapter.episode_id, summary)


def story_so_far(conn: sqlite3.Connection, chapter_id: str) -> list[str]:
    """What a beat of the chapter is told of the story before it, oldest first (§10)."""
    chapter = chapters_db.get_chapter(conn, chapter_id)
    if chapter is None:
        return []
    rows = chapters_db.summaries_up_to(conn, chapter.work_id, chapter.number)
    earlier = [row for row in rows if row.id != chapter_id]
    current = next((row for row in rows if row.id == chapter_id), None)
    lines: list[str] = []
    told: set[str] = set()
    for at, row in enumerate(earlier):
        before = at == len(earlier) - 1
        if row.episode_id != chapter.episode_id and row.episode_summary:
            if row.episode_id not in told:
                told.add(row.episode_id)
                lines.append(f"앞선 에피소드 {row.episode_name}: {row.episode_summary}")
            if not before:
                continue
        if before and row.long:
            lines.append(f"{row.number}화 (바로 앞 화): {row.long}")
        elif row.short:
            lines.append(f"{row.number}화: {row.short}")
    if current is not None and current.progress:
        lines.append(f"이번 화 지금까지: {current.progress}")
    return lines
