"""Drafts (§16): the card drawer's conversation, notes, generation and save (§8)."""

from collections.abc import AsyncIterator

from fastapi import APIRouter, Request, Response
from fastapi.responses import StreamingResponse

from aiplot.api.deps import Db
from aiplot.api.errors import AppError
from aiplot.generated.card.card import Card
from aiplot.generated.drafts.draft import Draft
from aiplot.generated.drafts.draft_create import DraftCreate
from aiplot.generated.drafts.draft_generate import DraftGenerate
from aiplot.generated.drafts.draft_message import DraftMessage
from aiplot.generated.drafts.draft_source import DraftSource
from aiplot.generated.jobs.job_accepted import JobAccepted
from aiplot.jobs.queue import JobQueue
from aiplot.llm.runtime import LlmRuntime
from aiplot.services import cards, draft_card, draft_chat, drafts, works

router = APIRouter()


def store(request: Request) -> drafts.DraftStore:
    open_drafts: drafts.DraftStore = request.app.state.drafts
    return open_drafts


def draft_not_found(draft_id: str) -> AppError:
    return AppError(404, "DRAFT_NOT_FOUND", f"no open draft {draft_id}", "open the drawer again")


@router.post("/works/{workId}/drafts", status_code=201)
def create_draft(db: Db, request: Request, workId: str, body: DraftCreate) -> Draft:
    try:
        return drafts.create(db, store(request), workId, body)
    except works.WorkNotFoundError as exc:
        raise AppError(404, "WORK_NOT_FOUND", f"no work {workId}") from exc
    except works.StageLockedError as exc:
        raise AppError(423, "STAGE_LOCKED", str(exc), "reopen the stage to change it") from exc
    except cards.CardNotFoundError as exc:
        raise AppError(404, "CARD_NOT_FOUND", f"no card {exc} in this work") from exc
    except drafts.DraftInvalidError as exc:
        raise AppError(422, "DRAFT_INVALID", str(exc)) from exc


@router.get("/drafts/{draftId}")
def get_draft(request: Request, draftId: str) -> Draft:
    try:
        return store(request).get(draftId).view()
    except drafts.DraftNotFoundError as exc:
        raise draft_not_found(draftId) from exc


@router.post("/drafts/{draftId}/messages")
async def post_message(
    db: Db, request: Request, draftId: str, body: DraftMessage
) -> StreamingResponse:
    """One chat turn as SSE (DraftMessageEvent): the reply as it streams, then the notes."""
    try:
        draft = store(request).get(draftId)
        turn = draft_chat.prepare(db, draft, body.text, list(body.refs or []))
    except drafts.DraftNotFoundError as exc:
        raise draft_not_found(draftId) from exc
    except works.WorkNotFoundError as exc:
        raise AppError(404, "WORK_NOT_FOUND", f"the work of {draftId} is gone") from exc
    except works.StageLockedError as exc:
        raise AppError(423, "STAGE_LOCKED", str(exc), "reopen the stage to change it") from exc
    except draft_chat.DraftBusyError as exc:
        raise AppError(409, "DRAFT_BUSY", "the AI is still answering", "wait for done") from exc
    except draft_chat.MessageEmptyError as exc:
        raise AppError(422, "MESSAGE_EMPTY", str(exc)) from exc
    runtime: LlmRuntime = request.app.state.llm

    async def stream() -> AsyncIterator[str]:
        async for name, data in draft_chat.converse(runtime.router, turn):
            yield f"event: {name}\ndata: {data.model_dump_json()}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.put("/drafts/{draftId}/source")
def put_source(request: Request, draftId: str, body: DraftSource) -> Draft:
    try:
        return drafts.set_notes(store(request), draftId, body.notes)
    except drafts.DraftNotFoundError as exc:
        raise draft_not_found(draftId) from exc


@router.delete("/drafts/{draftId}", status_code=204)
async def delete_draft(request: Request, draftId: str) -> Response:
    """Closing the drawer: the conversation and anything unsaved are gone (§6), and a running
    generation stops. Async: cancelling touches the job queue on the event loop."""
    try:
        draft = store(request).get(draftId)
        store(request).remove(draftId)
    except drafts.DraftNotFoundError as exc:
        raise draft_not_found(draftId) from exc
    draft_card.cancel(request.app.state.jobs, draft)
    return Response(status_code=204)


@router.post("/drafts/{draftId}/generate", status_code=202)
async def generate(db: Db, request: Request, draftId: str, body: DraftGenerate) -> JobAccepted:
    """카드 생성 as a job (async: the job queue lives on the event loop)."""
    try:
        draft = store(request).get(draftId)
        generation = draft_card.prepare(
            db, draft, None if body.pinned is None else list(body.pinned), body.structure
        )
    except drafts.DraftNotFoundError as exc:
        raise draft_not_found(draftId) from exc
    except works.WorkNotFoundError as exc:
        raise AppError(404, "WORK_NOT_FOUND", f"the work of {draftId} is gone") from exc
    except works.StageLockedError as exc:
        raise AppError(423, "STAGE_LOCKED", str(exc), "reopen the stage to change it") from exc
    runtime: LlmRuntime = request.app.state.llm
    jobs: JobQueue = request.app.state.jobs
    job_id = draft_card.start(runtime.router, jobs, request.app.state.db_path, generation)
    return JobAccepted(jobId=job_id)


@router.post("/drafts/{draftId}/save")
async def save(db: Db, request: Request, draftId: str) -> Card:
    """저장: notes + card + relations in one transaction; the draft closes (§8). Async: one
    save at a time on the event loop (a double click never makes two cards)."""
    try:
        return draft_card.save(db, store(request), request.app.state.jobs, draftId)
    except drafts.DraftNotFoundError as exc:
        raise draft_not_found(draftId) from exc
    except draft_card.NothingToSaveError as exc:
        raise AppError(409, "NOTHING_TO_SAVE", str(exc), "카드 생성 first") from exc
    except draft_card.CardStaleError as exc:
        raise AppError(409, "CARD_STALE", str(exc), "generate the card again") from exc
    except works.WorkNotFoundError as exc:
        raise AppError(404, "WORK_NOT_FOUND", f"the work of {draftId} is gone") from exc
    except works.StageLockedError as exc:
        raise AppError(423, "STAGE_LOCKED", str(exc), "reopen the stage to change it") from exc
    except cards.CardNotFoundError as exc:
        raise AppError(404, "CARD_NOT_FOUND", f"{exc} was deleted meanwhile") from exc
    except cards.CardConflictError as exc:
        raise AppError(409, "CARD_CONFLICT", str(exc)) from exc
