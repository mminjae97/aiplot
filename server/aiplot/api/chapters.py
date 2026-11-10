"""The manuscript (§16 writing: GET /works/{workId}/chapters)."""

from fastapi import APIRouter

from aiplot.api.deps import Db
from aiplot.api.errors import AppError
from aiplot.generated.writing.chapter_list import ChapterList
from aiplot.services import manuscript, works

router = APIRouter()


@router.get("/works/{workId}/chapters")
def list_chapters(db: Db, workId: str) -> ChapterList:
    if works.get(db, workId) is None:
        raise AppError(404, "WORK_NOT_FOUND", f"no work {workId}")
    return ChapterList(chapters=manuscript.chapters(db, workId))
