"""Stage warnings and reopening (§11): what an advance makes inactive, what a reopen deletes, and
the reopen itself, which copies the database to a snapshot before it deletes anything (§6)."""

import logging
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from aiplot.db import cards as cards_db
from aiplot.db import chapters as chapters_db
from aiplot.db import plans as plans_db
from aiplot.db import snapshots as snapshots_db
from aiplot.db import works as works_db
from aiplot.db.connection import transaction
from aiplot.generated.works.stage_advance_preview import (
    InactiveCard,
    ReferencingCard,
    StageAdvancePreview,
)
from aiplot.generated.works.stage_reopen_preview import StageReopenPreview
from aiplot.generated.works.work import Work
from aiplot.services.works import (
    StageFinalError,
    TitleEmptyError,
    TitleTooLongError,
    WorkNotFoundError,
    clean_title,
    now,
)

logger = logging.getLogger(__name__)


class StageNotLockedError(ValueError):
    """Only a locked stage can be reopened: the current one is open already, later ones have
    not begun."""


class TitleMismatchError(ValueError):
    """Deleting a manuscript needs the work's title typed (§5, §11)."""


class SnapshotFailedError(OSError):
    """The copy could not be written; nothing was deleted."""


def require_work(conn: sqlite3.Connection, work_id: str) -> Work:
    work = works_db.get(conn, work_id)
    if work is None:
        raise WorkNotFoundError(work_id)
    return work


def advance_preview(conn: sqlite3.Connection, work_id: str) -> StageAdvancePreview:
    """The current stage's lock warning (§11): active episodes, those without a confirmed plan,
    and every incomplete card with the complete cards referencing it."""
    work = require_work(conn, work_id)
    if work.stage == 3:
        raise StageFinalError("writing is the last stage")
    incomplete = []
    for row in cards_db.list_for_work(conn, work_id):
        if row.status != "incomplete":
            continue
        seen: dict[str, ReferencingCard] = {}
        for ref_id, _ in cards_db.references(conn, row.id):
            ref = cards_db.get(conn, ref_id)
            if ref is not None and ref.status == "complete" and ref.id not in seen:
                seen[ref.id] = ReferencingCard.model_validate(
                    {"card_id": ref.id, "type": ref.type, "name": ref.name}
                )
        incomplete.append(
            InactiveCard.model_validate(
                {
                    "card_id": row.id,
                    "type": row.type,
                    "name": row.name,
                    "referenced_by": list(seen.values()),
                }
            )
        )
    return StageAdvancePreview.model_validate(
        {
            "stage": work.stage,
            "active_episodes": works_db.active_episode_count(conn, work_id),
            "unconfirmed_episodes": works_db.unconfirmed_count(conn, work_id),
            "incomplete": incomplete,
        }
    )


def reopen_preview(conn: sqlite3.Connection, work_id: str, stage: int) -> StageReopenPreview:
    """What reopening the locked stage deletes: planning takes the direction plans and the
    manuscript with it; direction only the manuscript. Chapters are counted once they hold
    text."""
    work = require_work(conn, work_id)
    if stage < 1 or stage > work.locked_stage:
        raise StageNotLockedError(f"stage {stage} of {work_id} is not locked")
    plans = plans_db.count_for_work(conn, work_id) if stage == 1 else 0
    chapters = chapters_db.written_count(conn, work_id)
    return StageReopenPreview(
        stage=stage, plans=plans, chapters=chapters, title_required=chapters > 0
    )


def check_reopen(conn: sqlite3.Connection, work_id: str, stage: int, title: str | None) -> None:
    """The stage is locked, and the work's title was typed if a manuscript goes (§5, §11)."""
    if not reopen_preview(conn, work_id, stage).title_required:
        return
    try:
        typed = clean_title(title or "")
    except (TitleEmptyError, TitleTooLongError):
        typed = None
    if typed != require_work(conn, work_id).title:
        raise TitleMismatchError("the typed title does not match the work's")


def snapshot_name(snapshots_dir: Path, work_id: str, stage: int, at: datetime) -> str:
    """{workId}-s{stage}-{YYYYMMDD-HHMMSS}.db, numbered on when that name is taken."""
    base = f"{work_id}-s{stage}-{at.strftime('%Y%m%d-%H%M%S')}"
    name, number = f"{base}.db", 1
    while (snapshots_dir / name).exists():
        number += 1
        name = f"{base}-{number}.db"
    return name


def reopen(
    conn: sqlite3.Connection, snapshots_dir: Path, work_id: str, stage: int, title: str | None
) -> Work:
    """Copies the database to a snapshot, then deletes what the stage's later stages hold and
    opens it again (§11); cards are kept. A failed copy deletes nothing."""
    check_reopen(conn, work_id, stage, title)
    at = datetime.now(UTC)
    try:
        snapshots_dir.mkdir(parents=True, exist_ok=True)
        name = snapshot_name(snapshots_dir, work_id, stage, at)
        snapshots_db.copy_database(conn, snapshots_dir / name)
    except (OSError, sqlite3.Error) as exc:
        raise SnapshotFailedError(f"could not write the snapshot: {exc}") from exc
    try:
        with transaction(conn):
            # Checked again: another request may have reopened or advanced meanwhile, or a
            # first beat been written (the title is needed then).
            check_reopen(conn, work_id, stage, title)
            chapters_db.delete_for_work(conn, work_id)
            if stage == 1:
                plans_db.delete_for_work(conn, work_id)
            works_db.reopen_stage(conn, work_id, stage, now())
            snapshots_db.insert(conn, work_id, stage, name, now())
    except BaseException:
        # Nothing was deleted: the copy is not a snapshot of a reopen.
        (snapshots_dir / name).unlink(missing_ok=True)
        raise
    reopened = works_db.get(conn, work_id)
    assert reopened is not None
    return reopened
