"""Library books: list, create, open, rename and decorate, delete (§16 works)."""

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import FileResponse

from aiplot.api.deps import Db
from aiplot.api.errors import AppError
from aiplot.generated.works.cover import Cover
from aiplot.generated.works.cover_list import CoverList
from aiplot.generated.works.stage_advance_preview import StageAdvancePreview
from aiplot.generated.works.stage_reopen import StageReopen
from aiplot.generated.works.stage_reopen_preview import StageReopenPreview
from aiplot.generated.works.work import Work
from aiplot.generated.works.work_create import WorkCreate
from aiplot.generated.works.work_list import WorkList
from aiplot.generated.works.work_update import WorkUpdate
from aiplot.jobs.queue import JobQueue
from aiplot.services import covers, stage, works

router = APIRouter()


def images_dir(request: Request) -> Path:
    path: Path = request.app.state.images_dir
    return path


def work_not_found(work_id: str) -> AppError:
    return AppError(404, "WORK_NOT_FOUND", f"no work {work_id}")


def title_error(exc: works.TitleEmptyError | works.TitleTooLongError) -> AppError:
    if isinstance(exc, works.TitleEmptyError):
        return AppError(422, "TITLE_EMPTY", "the title is blank")
    return AppError(422, "TITLE_TOO_LONG", f"the title is over {works.TITLE_MAX} chars")


def cover_not_found(cover_id: str) -> AppError:
    return AppError(404, "COVER_NOT_FOUND", f"no cover {cover_id} in this work")


@router.get("/works")
def list_works(db: Db) -> WorkList:
    return WorkList(works=works.list_recent(db))


@router.post("/works", status_code=201)
def create_work(db: Db, body: WorkCreate) -> Work:
    try:
        return works.create(db, body.title)
    except (works.TitleEmptyError, works.TitleTooLongError) as exc:
        raise title_error(exc) from exc


@router.get("/works/{workId}")
def get_work(db: Db, workId: str) -> Work:
    work = works.get(db, workId)
    if work is None:
        raise work_not_found(workId)
    return work


@router.patch("/works/{workId}")
def update_work(db: Db, workId: str, body: WorkUpdate) -> Work:
    if not body.model_fields_set:
        raise AppError(422, "VALIDATION_ERROR", "body: send at least one field")
    # The generated model lets an optional key be null; a title never is.
    if "title" in body.model_fields_set and body.title is None:
        raise AppError(422, "VALIDATION_ERROR", "body.title: must be a string")
    try:
        return works.update(db, workId, body)
    except (works.TitleEmptyError, works.TitleTooLongError) as exc:
        raise title_error(exc) from exc
    except works.WorkNotFoundError as exc:
        raise work_not_found(workId) from exc
    except works.CoverNotFoundError as exc:
        raise cover_not_found(str(exc)) from exc


@router.delete("/works/{workId}", status_code=204)
def delete_work(db: Db, request: Request, workId: str) -> None:
    try:
        works.delete(db, images_dir(request), workId, request.app.state.snapshots_dir)
    except works.WorkNotFoundError as exc:
        raise work_not_found(workId) from exc


@router.post("/works/{workId}/stage/advance")
def advance_stage(db: Db, workId: str) -> Work:
    """Locks the current stage (§11); the app warns first, listing incomplete cards."""
    try:
        return works.advance(db, workId)
    except works.WorkNotFoundError as exc:
        raise work_not_found(workId) from exc
    except works.NoActiveEpisodeError as exc:
        raise AppError(
            409, "NO_ACTIVE_EPISODE", str(exc), "complete an episode, its part and the main story"
        ) from exc
    except works.StageNotReadyError as exc:
        raise AppError(409, "STAGE_NOT_READY", str(exc)) from exc
    except works.StageFinalError as exc:
        raise AppError(409, "STAGE_FINAL", str(exc)) from exc


@router.get("/works/{workId}/stage/advance-preview")
def advance_preview(db: Db, workId: str) -> StageAdvancePreview:
    """The lock warning's contents: what the advance makes inactive (§11)."""
    try:
        return stage.advance_preview(db, workId)
    except works.WorkNotFoundError as exc:
        raise work_not_found(workId) from exc
    except works.StageFinalError as exc:
        raise AppError(409, "STAGE_FINAL", str(exc)) from exc


@router.get("/works/{workId}/stage/reopen-preview")
def reopen_preview(
    db: Db, workId: str, stage_: Annotated[int, Query(alias="stage")]
) -> StageReopenPreview:
    """What reopening the locked stage deletes, for the warning's counts (§11)."""
    try:
        return stage.reopen_preview(db, workId, stage_)
    except works.WorkNotFoundError as exc:
        raise work_not_found(workId) from exc
    except stage.StageNotLockedError as exc:
        raise AppError(409, "STAGE_NOT_LOCKED", str(exc)) from exc


@router.post("/works/{workId}/stage/reopen")
async def reopen_stage(db: Db, request: Request, workId: str, body: StageReopen) -> Work:
    """A snapshot, then the later stages' data deleted and the stage open again (§11). Async:
    the work's direction and writing jobs are cancelled on the event loop."""
    try:
        work = stage.reopen(db, request.app.state.snapshots_dir, workId, body.stage, body.title)
    except works.WorkNotFoundError as exc:
        raise work_not_found(workId) from exc
    except stage.StageNotLockedError as exc:
        raise AppError(409, "STAGE_NOT_LOCKED", str(exc)) from exc
    except stage.TitleMismatchError as exc:
        raise AppError(422, "TITLE_MISMATCH", str(exc), "type the work's title") from exc
    except stage.SnapshotFailedError as exc:
        raise AppError(500, "SNAPSHOT_FAILED", str(exc), "check the disk and try again") from exc
    jobs: JobQueue = request.app.state.jobs
    for job in jobs.for_work(workId):
        # Their plans or chapters are gone or about to be stale against the reopened stage.
        # Nothing ran between the reopen and here (no await), so none of them stored
        # anything after the snapshot.
        if job.kind in ("plan", "direct", "chapter", "beat", "recheck"):
            jobs.cancel(job)
    return work


@router.get("/works/{workId}/covers")
def list_covers(db: Db, workId: str) -> CoverList:
    try:
        return CoverList(covers=covers.list_for_work(db, workId))
    except works.WorkNotFoundError as exc:
        raise work_not_found(workId) from exc


def too_large() -> AppError:
    return AppError(413, "COVER_TOO_LARGE", f"cover is over {covers.MAX_BYTES} bytes")


async def cover_body(request: Request) -> bytes:
    """The upload, refused as soon as it is known to be over the limit (from Content-Length,
    else while it streams in), never read whole first."""
    length = request.headers.get("content-length", "")
    if length.isdigit() and int(length) > covers.MAX_BYTES:
        raise too_large()
    data = bytearray()
    async for chunk in request.stream():
        data += chunk
        if len(data) > covers.MAX_BYTES:
            raise too_large()
    if not data:
        raise AppError(422, "VALIDATION_ERROR", "the cover body is empty")
    return bytes(data)


@router.post(
    "/works/{workId}/covers",
    status_code=201,
    openapi_extra={"requestBody": {"content": {"image/webp": {}}, "required": True}},
)
def upload_cover(
    db: Db,
    request: Request,
    workId: str,
    body: Annotated[bytes, Depends(cover_body)],
) -> Cover:
    try:
        return covers.add(db, images_dir(request), workId, body)
    except works.WorkNotFoundError as exc:
        raise work_not_found(workId) from exc
    except covers.CoverTooLargeError as exc:
        raise too_large() from exc
    except covers.CoverUnsupportedError as exc:
        raise AppError(415, "COVER_UNSUPPORTED", str(exc), "the app sends WebP") from exc


@router.get("/works/{workId}/covers/{coverId}/image", response_class=FileResponse)
def get_cover_image(db: Db, request: Request, workId: str, coverId: str) -> FileResponse:
    try:
        path = covers.file_of(db, images_dir(request), workId, coverId)
    except works.CoverNotFoundError as exc:
        raise cover_not_found(coverId) from exc
    return FileResponse(path, media_type="image/webp")


@router.delete("/works/{workId}/covers/{coverId}", status_code=204)
def delete_cover(db: Db, request: Request, workId: str, coverId: str) -> None:
    try:
        covers.delete(db, images_dir(request), workId, coverId)
    except works.CoverNotFoundError as exc:
        raise cover_not_found(coverId) from exc
