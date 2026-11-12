"""SQL for the manuscript's chapters and beats (§14)."""

import sqlite3
from collections import defaultdict
from dataclasses import dataclass

from aiplot.generated.direction.plan import PlanBeat
from aiplot.generated.writing.beat_version import BeatVersion
from aiplot.generated.writing.chapter import Chapter
from aiplot.generated.writing.chapter_text import ChapterText

# A beat's current version: the latest one (§14).
CURRENT_VERSION = (
    "SELECT v.beat_id, v.version, v.chars FROM beat_version AS v "
    "WHERE v.version = (SELECT max(version) FROM beat_version WHERE beat_id = v.beat_id)"
)


def insert_chapter(
    conn: sqlite3.Connection,
    chapter_id: str,
    plan_id: str,
    work_id: str,
    number: int,
    target_chars: int,
) -> None:
    conn.execute(
        "INSERT INTO chapter (id, plan_id, work_id, number, target_chars) VALUES (?, ?, ?, ?, ?)",
        (chapter_id, plan_id, work_id, number, target_chars),
    )


def insert_beat(
    conn: sqlite3.Connection,
    beat_id: str,
    chapter_id: str,
    order: int,
    scene: int,
    source_stage: str,
    beat: PlanBeat,
) -> None:
    """The plan beat as the chapter's order-th beat, with the cards it names (each once)."""
    conn.execute(
        'INSERT INTO beat (id, chapter_id, "order", scene, source_stage, summary, pov, mode, '
        "focus, density, tension, target_chars) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            beat_id,
            chapter_id,
            order,
            scene,
            source_stage,
            beat.summary,
            beat.pov,
            beat.mode,
            beat.focus,
            beat.density,
            beat.tension,
            beat.target_chars,
        ),
    )
    conn.executemany(
        "INSERT OR IGNORE INTO beat_technique (beat_id, technique_id) VALUES (?, ?)",
        [(beat_id, technique_id) for technique_id in beat.techniques],
    )


def list_for_work(conn: sqlite3.Connection, work_id: str) -> list[Chapter]:
    """The work's chapters in order, each with its beats in order."""
    techniques: dict[str, list[str]] = defaultdict(list)
    for row in conn.execute(
        "SELECT t.beat_id, t.technique_id FROM beat_technique AS t "
        "JOIN beat ON beat.id = t.beat_id JOIN chapter ON chapter.id = beat.chapter_id "
        "WHERE chapter.work_id = ? ORDER BY t.rowid",
        (work_id,),
    ):
        techniques[row["beat_id"]].append(row["technique_id"])
    beats: dict[str, list[dict[str, object]]] = defaultdict(list)
    chars: dict[str, int] = defaultdict(int)
    for row in conn.execute(
        'SELECT beat.id, beat.chapter_id, beat."order", beat.scene, beat.source_stage, '
        "beat.summary, beat.pov, beat.mode, beat.focus, beat.density, beat.tension, "
        "beat.target_chars, cur.version, cur.chars FROM beat "
        "JOIN chapter ON chapter.id = beat.chapter_id "
        f"LEFT JOIN ({CURRENT_VERSION}) AS cur ON cur.beat_id = beat.id "
        'WHERE chapter.work_id = ? ORDER BY beat."order"',
        (work_id,),
    ):
        found = dict(row)
        chapter_id = found.pop("chapter_id")
        beats[chapter_id].append({**found, "techniques": techniques[row["id"]]})
        chars[chapter_id] += row["chars"] or 0
    chapters = conn.execute(
        "SELECT chapter.id, chapter.plan_id, d.episode_id, chapter.number, chapter.target_chars, "
        "chapter.read FROM chapter JOIN direction_plan AS d ON d.id = chapter.plan_id "
        "WHERE chapter.work_id = ? ORDER BY chapter.number",
        (work_id,),
    ).fetchall()
    return [
        Chapter.model_validate(
            {
                **dict(row),
                "read": bool(row["read"]),
                "chars": chars[row["id"]],
                "beats": beats[row["id"]],
            }
        )
        for row in chapters
    ]


def written_count(conn: sqlite3.Connection, work_id: str) -> int:
    """Chapters holding text: at least one of their beats has a version."""
    row = conn.execute(
        "SELECT count(*) FROM chapter WHERE work_id = ? AND EXISTS ("
        "SELECT 1 FROM beat JOIN beat_version AS v ON v.beat_id = beat.id "
        "WHERE beat.chapter_id = chapter.id)",
        (work_id,),
    ).fetchone()
    return int(row[0])


def delete_for_work(conn: sqlite3.Connection, work_id: str) -> None:
    # Their beats, the beats' cards and versions go with them (ON DELETE CASCADE); the
    # episodes' summaries were made from them.
    conn.execute("DELETE FROM chapter WHERE work_id = ?", (work_id,))
    conn.execute(
        "UPDATE episode SET summary = NULL "
        "WHERE card_id IN (SELECT id FROM card WHERE work_id = ?)",
        (work_id,),
    )


@dataclass(frozen=True)
class ChapterSummary:
    """A chapter with what was summarized of it (§10) and its episode's name and summary."""

    id: str
    episode_id: str
    number: int
    progress: str | None
    long: str | None
    short: str | None
    episode_name: str
    episode_summary: str | None


def summaries_up_to(conn: sqlite3.Connection, work_id: str, number: int) -> list[ChapterSummary]:
    """The work's chapters up to this number, in order."""
    rows = conn.execute(
        "SELECT chapter.id, d.episode_id, chapter.number, chapter.progress_summary AS progress, "
        "chapter.summary_long AS long, chapter.summary_short AS short, c.name AS episode_name, "
        "ep.summary AS episode_summary FROM chapter "
        "JOIN direction_plan AS d ON d.id = chapter.plan_id "
        "JOIN card AS c ON c.id = d.episode_id JOIN episode AS ep ON ep.card_id = d.episode_id "
        "WHERE chapter.work_id = ? AND chapter.number <= ? ORDER BY chapter.number, chapter.rowid",
        (work_id, number),
    ).fetchall()
    return [ChapterSummary(**dict(row)) for row in rows]


def chapters_of_plan(conn: sqlite3.Connection, plan_id: str) -> list[ChapterSummary]:
    """The episode's chapters in order."""
    rows = conn.execute(
        "SELECT chapter.id, d.episode_id, chapter.number, chapter.progress_summary AS progress, "
        "chapter.summary_long AS long, chapter.summary_short AS short, c.name AS episode_name, "
        "ep.summary AS episode_summary FROM chapter "
        "JOIN direction_plan AS d ON d.id = chapter.plan_id "
        "JOIN card AS c ON c.id = d.episode_id JOIN episode AS ep ON ep.card_id = d.episode_id "
        "WHERE chapter.plan_id = ? ORDER BY chapter.number, chapter.rowid",
        (plan_id,),
    ).fetchall()
    return [ChapterSummary(**dict(row)) for row in rows]


def set_progress(conn: sqlite3.Connection, chapter_id: str, progress: str | None) -> None:
    """The summary of a chapter still being written; its end summaries are no longer true."""
    conn.execute(
        "UPDATE chapter SET progress_summary = ?, summary_long = NULL, summary_short = NULL "
        "WHERE id = ?",
        (progress, chapter_id),
    )


def set_end_summaries(conn: sqlite3.Connection, chapter_id: str, long: str, short: str) -> None:
    """The summaries of a chapter written to its end; the one of its progress is done with."""
    conn.execute(
        "UPDATE chapter SET progress_summary = NULL, summary_long = ?, summary_short = ? "
        "WHERE id = ?",
        (long, short, chapter_id),
    )


def set_episode_summary(conn: sqlite3.Connection, episode_id: str, summary: str | None) -> None:
    conn.execute("UPDATE episode SET summary = ? WHERE card_id = ?", (summary, episode_id))


@dataclass(frozen=True)
class ChapterRow:
    id: str
    plan_id: str
    episode_id: str
    work_id: str
    number: int
    target_chars: int


@dataclass(frozen=True)
class BeatRow:
    """A beat as the write role needs it: its plan values and the cards it names, in order."""

    id: str
    chapter_id: str
    order: int
    scene: int
    source_stage: str
    summary: str
    pov: str
    mode: str
    focus: str
    density: str
    tension: int
    target_chars: int
    techniques: tuple[str, ...]


CHAPTER_COLUMNS = (
    "chapter.id, chapter.plan_id, d.episode_id, chapter.work_id, chapter.number, "
    "chapter.target_chars"
)
CHAPTER_FROM = "FROM chapter JOIN direction_plan AS d ON d.id = chapter.plan_id"


def get_chapter(conn: sqlite3.Connection, chapter_id: str) -> ChapterRow | None:
    row = conn.execute(
        f"SELECT {CHAPTER_COLUMNS} {CHAPTER_FROM} WHERE chapter.id = ?", (chapter_id,)
    ).fetchone()
    return ChapterRow(**dict(row)) if row else None


def chapter_before(conn: sqlite3.Connection, chapter: ChapterRow) -> ChapterRow | None:
    """The chapter read just before this one in the work, if any."""
    row = conn.execute(
        f"SELECT {CHAPTER_COLUMNS} {CHAPTER_FROM} WHERE chapter.work_id = ? AND chapter.number < ? "
        "ORDER BY chapter.number DESC, chapter.rowid DESC LIMIT 1",
        (chapter.work_id, chapter.number),
    ).fetchone()
    return ChapterRow(**dict(row)) if row else None


def beats_of(conn: sqlite3.Connection, chapter_id: str) -> list[BeatRow]:
    """The chapter's beats in order."""
    techniques: dict[str, list[str]] = defaultdict(list)
    for row in conn.execute(
        "SELECT t.beat_id, t.technique_id FROM beat_technique AS t "
        "JOIN beat ON beat.id = t.beat_id WHERE beat.chapter_id = ? ORDER BY t.rowid",
        (chapter_id,),
    ):
        techniques[row["beat_id"]].append(row["technique_id"])
    rows = conn.execute(
        'SELECT id, chapter_id, "order", scene, source_stage, summary, pov, mode, focus, density, '
        'tension, target_chars FROM beat WHERE chapter_id = ? ORDER BY "order"',
        (chapter_id,),
    ).fetchall()
    return [BeatRow(**dict(row), techniques=tuple(techniques[row["id"]])) for row in rows]


def chapter_of_beat(conn: sqlite3.Connection, beat_id: str) -> str | None:
    row = conn.execute("SELECT chapter_id FROM beat WHERE id = ?", (beat_id,)).fetchone()
    return row[0] if row else None


def current_texts(conn: sqlite3.Connection, chapter_id: str) -> dict[str, str]:
    """beat id -> its current version's text, for the chapter's written beats."""
    rows = conn.execute(
        "SELECT v.beat_id, v.text FROM beat_version AS v JOIN beat ON beat.id = v.beat_id "
        "WHERE beat.chapter_id = ? AND v.version = "
        "(SELECT max(version) FROM beat_version WHERE beat_id = v.beat_id)",
        (chapter_id,),
    ).fetchall()
    return {row["beat_id"]: row["text"] for row in rows}


def current_chars(conn: sqlite3.Connection, chapter_id: str) -> dict[str, int]:
    """beat id -> its current version's chars, for the chapter's written beats."""
    rows = conn.execute(
        f"SELECT cur.beat_id, cur.chars FROM ({CURRENT_VERSION}) AS cur "
        "JOIN beat ON beat.id = cur.beat_id WHERE beat.chapter_id = ?",
        (chapter_id,),
    ).fetchall()
    return {row["beat_id"]: row["chars"] for row in rows}


def insert_version(
    conn: sqlite3.Connection,
    beat_id: str,
    text: str,
    chars: int,
    origin: str,
    prompt_version: int | None,
    style_id: str | None,
    style_version: int | None,
    created_at: str,
) -> int:
    """The beat's next version (its number): the latest one is the current one."""
    row = conn.execute(
        "SELECT coalesce(max(version), 0) + 1 FROM beat_version WHERE beat_id = ?", (beat_id,)
    ).fetchone()
    version = int(row[0])
    conn.execute(
        "INSERT INTO beat_version (beat_id, version, text, chars, origin, prompt_version, "
        "style_id, style_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            beat_id,
            version,
            text,
            chars,
            origin,
            prompt_version,
            style_id,
            style_version,
            created_at,
        ),
    )
    return version


VERSION_COLUMNS = "version, text, chars, origin, created_at"


def versions_of(conn: sqlite3.Connection, beat_id: str) -> list[BeatVersion]:
    """The beat's versions, oldest first: the last one is the current one."""
    rows = conn.execute(
        f"SELECT {VERSION_COLUMNS} FROM beat_version WHERE beat_id = ? ORDER BY version",
        (beat_id,),
    ).fetchall()
    return [BeatVersion.model_validate(dict(row)) for row in rows]


def get_version(conn: sqlite3.Connection, beat_id: str, version: int) -> BeatVersion | None:
    row = conn.execute(
        f"SELECT {VERSION_COLUMNS} FROM beat_version WHERE beat_id = ? AND version = ?",
        (beat_id, version),
    ).fetchone()
    return BeatVersion.model_validate(dict(row)) if row else None


def current_version(conn: sqlite3.Connection, beat_id: str) -> BeatVersion | None:
    row = conn.execute(
        f"SELECT {VERSION_COLUMNS} FROM beat_version WHERE beat_id = ? "
        "ORDER BY version DESC LIMIT 1",
        (beat_id,),
    ).fetchone()
    return BeatVersion.model_validate(dict(row)) if row else None


def chapter_text(conn: sqlite3.Connection, chapter_id: str) -> ChapterText | None:
    """The chapter with each beat's current version (nulls while unwritten)."""
    chapter = conn.execute("SELECT id, number FROM chapter WHERE id = ?", (chapter_id,)).fetchone()
    if chapter is None:
        return None
    beats = conn.execute(
        'SELECT beat.id, beat."order", v.version, v.chars, v.origin, v.text FROM beat '
        "LEFT JOIN beat_version AS v ON v.beat_id = beat.id AND v.version = "
        "(SELECT max(version) FROM beat_version WHERE beat_id = beat.id) "
        'WHERE beat.chapter_id = ? ORDER BY beat."order"',
        (chapter_id,),
    ).fetchall()
    return ChapterText.model_validate({**dict(chapter), "beats": [dict(row) for row in beats]})
