"""Direction plans (§16 direction): made per episode by a job, read by the S2 screen."""

from fastapi import APIRouter, Request

from aiplot.api.deps import Db
from aiplot.api.errors import AppError
from aiplot.generated.direction.plan_list import PlanList
from aiplot.generated.direction.plan_record import PlanRecord
from aiplot.generated.direction.plan_update import PlanUpdate
from aiplot.generated.direction.scene_devices import SceneDevicesUpdate
from aiplot.generated.direction.scene_pick import ScenePick
from aiplot.generated.jobs.job_accepted import JobAccepted
from aiplot.jobs.queue import JobQueue
from aiplot.llm.runtime import LlmRuntime
from aiplot.services import cards, direction, plan_scenes, plans, works

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


# Editing a plan's scenes ---------------------------------------------------------------------


def edit_error(exc: Exception, plan_id: str) -> AppError:
    """The API error for a refused edit (§16)."""
    if isinstance(exc, plan_scenes.PlanNotFoundError):
        return AppError(404, "PLAN_NOT_FOUND", f"no plan {plan_id}")
    if isinstance(exc, plan_scenes.SceneNotFoundError):
        return AppError(404, "SCENE_NOT_FOUND", str(exc))
    if isinstance(exc, cards.CardNotFoundError | works.WorkNotFoundError):
        return AppError(404, "PLAN_NOT_FOUND", f"the episode of {plan_id} is gone")
    if isinstance(exc, works.StageLockedError):
        return AppError(423, "STAGE_LOCKED", str(exc), "reopen the stage to change it")
    if isinstance(exc, works.StageNotStartedError):
        return AppError(409, "STAGE_NOT_STARTED", str(exc), "연출 구성 시작 first")
    if isinstance(exc, plan_scenes.ChoiceRefusedError):
        return AppError(422, exc.code, str(exc))
    if isinstance(exc, plan_scenes.LayoutInvalidError):
        return AppError(422, "PLAN_LAYOUT_INVALID", str(exc))
    raise exc


EDIT_ERRORS = (
    plan_scenes.PlanNotFoundError,
    plan_scenes.SceneNotFoundError,
    plan_scenes.ChoiceRefusedError,
    plan_scenes.LayoutInvalidError,
    cards.CardNotFoundError,
    works.WorkNotFoundError,
    works.StageLockedError,
    works.StageNotStartedError,
)


@router.put("/plans/{planId}/scenes/{scene}/devices")
def put_devices(db: Db, planId: str, scene: int, body: SceneDevicesUpdate) -> PlanRecord:
    """The user's checked devices; the scene's 5 recommendations are recomputed (§9)."""
    try:
        return plan_scenes.set_devices(db, planId, scene, body.devices)
    except EDIT_ERRORS as exc:
        raise edit_error(exc, planId) from exc


@router.post("/plans/{planId}/scenes/{scene}/pick")
def post_pick(db: Db, planId: str, scene: int, body: ScenePick) -> PlanRecord:
    """The 1-3 cards to direct the scene with (§9)."""
    try:
        return plan_scenes.pick(db, planId, scene, body.techniques)
    except EDIT_ERRORS as exc:
        raise edit_error(exc, planId) from exc


@router.patch("/plans/{planId}")
def patch_plan(db: Db, planId: str, body: PlanUpdate) -> PlanRecord:
    """The user's narration order and cuts; scenes whose place changed become stale (§9)."""
    try:
        return plan_scenes.rearrange(db, planId, body.chapters)
    except EDIT_ERRORS as exc:
        raise edit_error(exc, planId) from exc
