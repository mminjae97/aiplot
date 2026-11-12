"""The manuscript (§16 writing): the chapters, the jobs writing their beats and the warnings
on them."""

from fastapi import APIRouter, Request

from aiplot.api.deps import Db
from aiplot.api.errors import AppError
from aiplot.generated.jobs.job_accepted import JobAccepted
from aiplot.generated.writing.chapter_list import ChapterList
from aiplot.generated.writing.warning import Warning
from aiplot.generated.writing.warning_list import WarningList
from aiplot.generated.writing.warning_update import WarningUpdate
from aiplot.jobs.queue import JobQueue
from aiplot.llm.runtime import LlmRuntime
from aiplot.services import checks, manuscript, works, write_context, writing

router = APIRouter()


@router.get("/works/{workId}/chapters")
def list_chapters(db: Db, workId: str) -> ChapterList:
    if works.get(db, workId) is None:
        raise AppError(404, "WORK_NOT_FOUND", f"no work {workId}")
    return ChapterList(chapters=manuscript.chapters(db, workId))


def refusal(exc: Exception) -> AppError:
    """The API error for a writing job that may not start (§16)."""
    if isinstance(exc, writing.ChapterNotFoundError):
        return AppError(404, "CHAPTER_NOT_FOUND", f"no chapter {exc}")
    if isinstance(exc, write_context.BeatNotFoundError):
        return AppError(404, "BEAT_NOT_FOUND", f"no beat {exc}")
    if isinstance(exc, writing.ChapterWrittenError):
        return AppError(409, "CHAPTER_WRITTEN", str(exc), "regenerate a beat to write it again")
    if isinstance(exc, works.StageLockedError):
        return AppError(423, "STAGE_LOCKED", str(exc), "reopen the stage to change it")
    if isinstance(exc, works.StageNotStartedError):
        return AppError(409, "STAGE_NOT_STARTED", str(exc), "집필 시작 first")
    return AppError(404, "WORK_NOT_FOUND", "the work of the chapter is gone")


REFUSED = (
    writing.ChapterNotFoundError,
    writing.ChapterWrittenError,
    write_context.BeatNotFoundError,
    works.WorkNotFoundError,
    works.StageLockedError,
    works.StageNotStartedError,
)


@router.post("/chapters/{chapterId}/generate", status_code=202)
async def generate_chapter(request: Request, chapterId: str) -> JobAccepted:
    """The chapter's beats without text, written in order as a job (async: the job queue lives
    on the event loop); the chapter's running job answers instead."""
    runtime: LlmRuntime = request.app.state.llm
    jobs: JobQueue = request.app.state.jobs
    try:
        job_id = writing.start_chapter(runtime.router, jobs, request.app.state.db_path, chapterId)
    except REFUSED as exc:
        raise refusal(exc) from exc
    return JobAccepted(jobId=job_id)


@router.post("/beats/{beatId}/regenerate", status_code=202)
async def regenerate_beat(request: Request, beatId: str) -> JobAccepted:
    """The beat written again as a new version, as a job; its running job answers instead."""
    runtime: LlmRuntime = request.app.state.llm
    jobs: JobQueue = request.app.state.jobs
    try:
        job_id = writing.start_beat(runtime.router, jobs, request.app.state.db_path, beatId)
    except REFUSED as exc:
        raise refusal(exc) from exc
    return JobAccepted(jobId=job_id)


@router.get("/chapters/{chapterId}/warnings")
def list_warnings(db: Db, chapterId: str) -> WarningList:
    """The warnings on the current versions of the chapter's beats."""
    try:
        return WarningList(warnings=checks.chapter_warnings(db, chapterId))
    except checks.ChapterNotFoundError as exc:
        raise AppError(404, "CHAPTER_NOT_FOUND", f"no chapter {exc}") from exc


@router.patch("/warnings/{warningId}")
def update_warning(db: Db, warningId: str, body: WarningUpdate) -> Warning:
    """무시 with a reason, or the warning opened again."""
    try:
        return checks.update_warning(db, warningId, body.status, body.reason)
    except checks.WarningNotFoundError as exc:
        raise AppError(404, "WARNING_NOT_FOUND", f"no warning {exc}") from exc
    except (works.StageLockedError, works.StageNotStartedError, works.WorkNotFoundError) as exc:
        raise refusal(exc) from exc
