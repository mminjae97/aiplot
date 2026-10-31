"""Cards (§16 cards): list and search, read, references, completeness, region position,
delete and restore. Cards are created and regenerated through drafts (unit 9)."""

from typing import Literal

from fastapi import APIRouter, Query, Request

from aiplot.api.deps import Db
from aiplot.api.errors import AppError
from aiplot.generated.card.card import Card
from aiplot.generated.card.card_deleted import CardDeleted
from aiplot.generated.card.card_list import CardList
from aiplot.generated.card.card_references import CardReferences
from aiplot.generated.card.completeness import Completeness
from aiplot.generated.card.region_position import RegionPosition
from aiplot.generated.card.relations import CardRelations
from aiplot.services import cards, works
from aiplot.services.trash import Trash

router = APIRouter()

CardType = Literal["world", "character", "region", "main_story", "part", "episode"]


def trash(request: Request) -> Trash:
    deleted: Trash = request.app.state.trash
    return deleted


def work_not_found(work_id: str) -> AppError:
    return AppError(404, "WORK_NOT_FOUND", f"no work {work_id}")


def card_not_found(card_id: str) -> AppError:
    return AppError(404, "CARD_NOT_FOUND", f"no card {card_id}")


def stage_locked(exc: Exception) -> AppError:
    return AppError(423, "STAGE_LOCKED", str(exc), "reopen the stage to change it")


@router.get("/works/{workId}/cards")
def list_cards(
    db: Db,
    workId: str,
    type: CardType | None = None,
    q: str | None = Query(default=None, max_length=100),
) -> CardList:
    try:
        return CardList(cards=cards.list_cards(db, workId, type, q))
    except works.WorkNotFoundError as exc:
        raise work_not_found(workId) from exc


@router.get("/works/{workId}/relations")
def work_relations(db: Db, workId: str, kind: Literal["world", "character", "origin"]) -> CardRelations:
    """함께 보기 (world -> card), the character graph and origin regions (character -> region)."""
    try:
        return CardRelations(relations=cards.relations(db, workId, kind))
    except works.WorkNotFoundError as exc:
        raise work_not_found(workId) from exc


@router.get("/works/{workId}/completeness")
def completeness(db: Db, workId: str) -> Completeness:
    try:
        return cards.completeness(db, workId)
    except works.WorkNotFoundError as exc:
        raise work_not_found(workId) from exc


@router.get("/cards/{cardId}")
def get_card(db: Db, cardId: str) -> Card:
    card = cards.get(db, cardId)
    if card is None:
        raise card_not_found(cardId)
    return card


@router.get("/cards/{cardId}/references")
def card_references(db: Db, cardId: str) -> CardReferences:
    try:
        return CardReferences(references=cards.references(db, cardId))
    except cards.CardNotFoundError as exc:
        raise card_not_found(cardId) from exc


@router.patch("/cards/{cardId}")
def move_region(db: Db, cardId: str, body: RegionPosition) -> Card:
    """Only a region's map_x/map_y (§6, §8); any other field fails validation (422)."""
    try:
        return cards.set_position(db, cardId, body.map_x, body.map_y)
    except cards.CardNotFoundError as exc:
        raise card_not_found(cardId) from exc
    except cards.NotARegionError as exc:
        raise AppError(
            422, "CARD_NOT_REGION", str(exc), "only regions have a map position"
        ) from exc
    except works.StageLockedError as exc:
        raise stage_locked(exc) from exc


@router.delete("/cards/{cardId}")
def delete_card(
    db: Db,
    request: Request,
    cardId: str,
    reconnect: bool = False,
    episodes: str | None = Query(default=None, max_length=100),
) -> CardDeleted:
    """Runs at once; POST .../restore undoes it for a few seconds (§8)."""
    try:
        deleted = cards.delete(db, trash(request), cardId, reconnect=reconnect, episodes=episodes)
    except cards.CardNotFoundError as exc:
        raise card_not_found(cardId) from exc
    except works.StageLockedError as exc:
        raise stage_locked(exc) from exc
    except cards.PartHasEpisodesError as exc:
        raise AppError(
            409, "PART_HAS_EPISODES", str(exc), "?episodes=move:{partId} or ?episodes=delete"
        ) from exc
    except cards.EpisodesTargetError as exc:
        raise AppError(422, "EPISODES_TARGET_INVALID", str(exc)) from exc
    ids = [row["id"] for table, row in deleted.snapshot.rows if table == "card"]
    return CardDeleted(deleted=ids, restore_until=deleted.restore_until)


@router.post("/cards/{cardId}/restore")
def restore_card(db: Db, request: Request, cardId: str) -> Card:
    try:
        return cards.restore(db, trash(request), cardId)
    except cards.RestoreExpiredError as exc:
        raise AppError(
            410, "RESTORE_EXPIRED", f"{cardId} can no longer be restored", "the delete is final"
        ) from exc
    except works.StageLockedError as exc:
        raise stage_locked(exc) from exc
