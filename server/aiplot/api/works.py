"""Library books: list, create, open, decorate (§16 works; the rest arrives in step 1 unit 8)."""

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Body, Request
from fastapi.responses import FileResponse

from aiplot.api.deps import Db
from aiplot.api.errors import AppError
from aiplot.generated.works.cover import Cover
from aiplot.generated.works.cover_list import CoverList
from aiplot.generated.works.work import Work
from aiplot.generated.works.work_create import WorkCreate
from aiplot.generated.works.work_list import WorkList
from aiplot.generated.works.work_update import WorkUpdate
from aiplot.services import covers, works

router = APIRouter()


def images_dir(request: Request) -> Path:
    path: Path = request.app.state.images_dir
    return path


def work_not_found(work_id: str) -> AppError:
    return AppError(404, "WORK_NOT_FOUND", f"no work {work_id}")


def cover_not_found(cover_id: str) -> AppError:
    return AppError(404, "COVER_NOT_FOUND", f"no cover {cover_id} in this work")


@router.get("/works")
def list_works(db: Db) -> WorkList:
    return WorkList(works=works.list_recent(db))


@router.post("/works", status_code=201)
def create_work(db: Db, body: WorkCreate) -> Work:
    try:
        return works.create(db, body.title)
    except works.TitleEmptyError as exc:
        raise AppError(422, "TITLE_EMPTY", "the title is blank") from exc
    except works.TitleTooLongError as exc:
        raise AppError(422, "TITLE_TOO_LONG", f"the title is over {works.TITLE_MAX} chars") from exc


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
    try:
        return works.decorate(db, workId, body)
    except works.WorkNotFoundError as exc:
        raise work_not_found(workId) from exc
    except works.CoverNotFoundError as exc:
        raise cover_not_found(str(exc)) from exc


@router.get("/works/{workId}/covers")
def list_covers(db: Db, workId: str) -> CoverList:
    try:
        return CoverList(covers=covers.list_for_work(db, workId))
    except works.WorkNotFoundError as exc:
        raise work_not_found(workId) from exc


@router.post("/works/{workId}/covers", status_code=201)
def upload_cover(
    db: Db,
    request: Request,
    workId: str,
    body: Annotated[bytes, Body(media_type="image/webp")],
) -> Cover:
    try:
        return covers.add(db, images_dir(request), workId, body)
    except works.WorkNotFoundError as exc:
        raise work_not_found(workId) from exc
    except covers.CoverTooLargeError as exc:
        raise AppError(413, "COVER_TOO_LARGE", str(exc)) from exc
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
