"""Library books: list, create, open (§16 works; the rest arrives in step 1 unit 8)."""

from fastapi import APIRouter

from aiplot.api.deps import Db
from aiplot.api.errors import AppError
from aiplot.generated.works.work import Work
from aiplot.generated.works.work_create import WorkCreate
from aiplot.generated.works.work_list import WorkList
from aiplot.services import works

router = APIRouter()


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
        raise AppError(404, "WORK_NOT_FOUND", f"no work {workId}")
    return work
