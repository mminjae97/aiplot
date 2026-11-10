"""SQL for the manuscript's chapters and beats (§14)."""

import sqlite3
from collections import defaultdict

from aiplot.generated.direction.plan import PlanBeat
from aiplot.generated.writing.chapter import Chapter

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
    # Their beats, the beats' cards and versions go with them (ON DELETE CASCADE).
    conn.execute("DELETE FROM chapter WHERE work_id = ?", (work_id,))
