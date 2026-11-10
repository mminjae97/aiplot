"""The manuscript's chapters and beats (§10, §14): made from the confirmed direction plans when
writing starts, deleted when direction or planning is reopened (§11)."""

import secrets
import sqlite3

from aiplot.db import chapters as chapters_db
from aiplot.db import plans as plans_db
from aiplot.generated.writing.chapter import Chapter


def create(conn: sqlite3.Connection, work_id: str) -> None:
    """Turns every active episode's confirmed plan into chapter and beat rows, inside the
    advance's transaction: chapters numbered through the work in the episodes' story order, a
    chapter's beats numbered through its scenes in narration order."""
    number = 0
    for record in plans_db.confirmed_in_story_order(conn, work_id):
        for chapter in record.plan.chapters:
            number += 1
            chapter_id = f"ch_{secrets.token_hex(8)}"
            chapters_db.insert_chapter(
                conn, chapter_id, record.id, work_id, number, chapter.target_chars
            )
            order = 0
            for scene in chapter.scenes:
                for beat in scene.beats:
                    order += 1
                    chapters_db.insert_beat(
                        conn,
                        f"b_{secrets.token_hex(8)}",
                        chapter_id,
                        order,
                        scene.scene,
                        scene.source,
                        beat,
                    )


def chapters(conn: sqlite3.Connection, work_id: str) -> list[Chapter]:
    """The work's chapters in order; none before writing starts."""
    return chapters_db.list_for_work(conn, work_id)
