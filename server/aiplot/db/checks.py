"""SQL for what the check role makes of a beat (§14): state records and warnings."""

import json
import sqlite3
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from aiplot.generated.writing.warning import Warning

WARNING_COLUMNS = (
    "w.id, v.beat_id, v.version, w.kind, w.sentence, w.card_id, w.status, w.reason, w.ignore_reason"
)
WARNING_FROM = "FROM warning AS w JOIN beat_version AS v ON v.id = w.version_id"


@dataclass(frozen=True)
class StateRow:
    card_id: str
    key: str
    value: dict[str, Any]


def version_id(conn: sqlite3.Connection, beat_id: str, version: int) -> int | None:
    row = conn.execute(
        "SELECT id FROM beat_version WHERE beat_id = ? AND version = ?", (beat_id, version)
    ).fetchone()
    return int(row[0]) if row else None


def replace_state(conn: sqlite3.Connection, beat_id: str, records: Sequence[StateRow]) -> None:
    """The beat's state records: those of the text it had before are gone."""
    conn.execute("DELETE FROM state_record WHERE beat_id = ?", (beat_id,))
    conn.executemany(
        "INSERT INTO state_record (beat_id, card_id, key, value) VALUES (?, ?, ?, ?)",
        [
            (beat_id, record.card_id, record.key, json.dumps(record.value, ensure_ascii=False))
            for record in records
        ],
    )


def state_before(
    conn: sqlite3.Connection, work_id: str, number: int, chapter_id: str, order: int
) -> list[StateRow]:
    """The state records of the work's beats before the order-th beat of this chapter (its
    number in the work), oldest first."""
    rows = conn.execute(
        "SELECT s.card_id, s.key, s.value FROM state_record AS s "
        "JOIN beat ON beat.id = s.beat_id JOIN chapter ON chapter.id = beat.chapter_id "
        "WHERE chapter.work_id = ? AND (chapter.number < ? "
        'OR (chapter.id = ? AND beat."order" < ?)) '
        'ORDER BY chapter.number, chapter.rowid, beat."order", s.id',
        (work_id, number, chapter_id, order),
    ).fetchall()
    return [StateRow(row["card_id"], row["key"], json.loads(row["value"])) for row in rows]


def insert_warning(
    conn: sqlite3.Connection,
    warning_id: str,
    version: int,
    card_id: str | None,
    kind: str,
    sentence: int | None,
    reason: str,
) -> None:
    """A warning on the beat version with this row id."""
    conn.execute(
        "INSERT INTO warning (id, version_id, card_id, kind, sentence, reason) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (warning_id, version, card_id, kind, sentence, reason),
    )


def warnings_of_chapter(conn: sqlite3.Connection, chapter_id: str) -> list[Warning]:
    """The warnings on the current versions of the chapter's beats, in beat order."""
    rows = conn.execute(
        f"SELECT {WARNING_COLUMNS} {WARNING_FROM} JOIN beat ON beat.id = v.beat_id "
        "WHERE beat.chapter_id = ? AND v.version = "
        "(SELECT max(version) FROM beat_version WHERE beat_id = v.beat_id) "
        'ORDER BY beat."order", w.rowid',
        (chapter_id,),
    ).fetchall()
    return [Warning.model_validate(dict(row)) for row in rows]


def get_warning(conn: sqlite3.Connection, warning_id: str) -> Warning | None:
    row = conn.execute(
        f"SELECT {WARNING_COLUMNS} {WARNING_FROM} WHERE w.id = ?", (warning_id,)
    ).fetchone()
    return Warning.model_validate(dict(row)) if row else None


def set_warning_status(
    conn: sqlite3.Connection, warning_id: str, status: str, ignore_reason: str | None
) -> None:
    conn.execute(
        "UPDATE warning SET status = ?, ignore_reason = ? WHERE id = ?",
        (status, ignore_reason, warning_id),
    )


def ignored_reasons(conn: sqlite3.Connection, work_id: str, limit: int) -> list[tuple[str, str]]:
    """(the warning's reason, why the user ignored it) for the work's warnings ignored with a
    reason, newest first."""
    rows = conn.execute(
        f"SELECT w.reason, w.ignore_reason {WARNING_FROM} JOIN beat ON beat.id = v.beat_id "
        "JOIN chapter ON chapter.id = beat.chapter_id "
        "WHERE chapter.work_id = ? AND w.status = 'ignored' AND w.ignore_reason IS NOT NULL "
        "ORDER BY w.rowid DESC LIMIT ?",
        (work_id, limit),
    ).fetchall()
    return [(row[0], row[1]) for row in rows]
