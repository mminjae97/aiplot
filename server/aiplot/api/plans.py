"""Direction plans (§16 direction): made per episode by a job, read by the S2 screen."""

from fastapi import APIRouter, Request

from aiplot.api.deps import Db
from aiplot.api.errors import AppError
from aiplot.generated.direction.plan_list import PlanList
from aiplot.generated.jobs.job_accepted import JobAccepted
from aiplot.jobs.queue import JobQueue
from aiplot.llm.runtime import LlmRuntime
from aiplot.services import cards, direction, plans, works

router = APIRouter()


@router.get("/episodes/{episodeId}/plans")
def list_plans(db: Db, episodeId: str) -> PlanList:
    try:
        return PlanList(plans=plans.for_episode(db, episodeId))
    except cards.CardNotFoundError as exc:
        raise AppError(404, "CARD_NOT_FOUND", f"no card {episodeId}") from exc


@router.post("/episodes/{episodeId}/plans", status_code=202)
async def create_plan(
    db: Db, request: Request, episodeId: str, replace: bool = False
) -> JobAccepted:
    """The episode's scenes, then their chapters, as a job (async: the job queue lives on the
    event loop). An episode with a plan needs replace=true, which drops everything it held."""
    try:
        work_id = plans.check_new(db, episodeId, replace)
    except cards.CardNotFoundError as exc:
        raise AppError(404, "CARD_NOT_FOUND", f"no card {episodeId}") from exc
    except works.WorkNotFoundError as exc:
        raise AppError(404, "WORK_NOT_FOUND", f"the work of {episodeId} is gone") from exc
    except works.StageLockedError as exc:
        raise AppError(423, "STAGE_LOCKED", str(exc), "reopen the stage to change it") from exc
    except works.StageNotStartedError as exc:
        raise AppError(409, "STAGE_NOT_STARTED", str(exc), "연출 구성 시작 first") from exc
    except direction.EpisodeNotReadyError as exc:
        raise AppError(
            409, "EPISODE_NOT_READY", str(exc), "complete the episode, its part and the story"
        ) from exc
    except plans.PlanExistsError as exc:
        raise AppError(409, "PLAN_EXISTS", str(exc), "replace=true to make it again") from exc
    runtime: LlmRuntime = request.app.state.llm
    jobs: JobQueue = request.app.state.jobs
    job_id = plans.start_new(
        runtime.router, jobs, request.app.state.db_path, episodeId, work_id, replace
    )
    return JobAccepted(jobId=job_id)
