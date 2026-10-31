"""Drafts (§16): the card drawer's conversation, notes, generation and save (§8)."""

from fastapi import APIRouter, Request, Response

from aiplot.api.deps import Db
from aiplot.api.errors import AppError
from aiplot.generated.drafts.draft import Draft
from aiplot.generated.drafts.draft_create import DraftCreate
from aiplot.generated.drafts.draft_source import DraftSource
from aiplot.services import cards, drafts, works

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


@router.put("/drafts/{draftId}/source")
def put_source(request: Request, draftId: str, body: DraftSource) -> Draft:
    try:
        return drafts.set_notes(store(request), draftId, body.notes)
    except drafts.DraftNotFoundError as exc:
        raise draft_not_found(draftId) from exc


@router.delete("/drafts/{draftId}", status_code=204)
def delete_draft(request: Request, draftId: str) -> Response:
    """Closing the drawer: the conversation and anything unsaved are gone (§6)."""
    try:
        store(request).remove(draftId)
    except drafts.DraftNotFoundError as exc:
        raise draft_not_found(draftId) from exc
    return Response(status_code=204)
