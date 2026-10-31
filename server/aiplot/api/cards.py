"""Cards (§16 cards): list and search, read, references, completeness, region position.
Cards are created and regenerated through drafts (unit 9); delete and restore come next."""

from typing import Literal

from fastapi import APIRouter, Query

from aiplot.api.deps import Db
from aiplot.api.errors import AppError
from aiplot.generated.card.card import Card
from aiplot.generated.card.card_list import CardList
from aiplot.generated.card.card_references import CardReferences
from aiplot.generated.card.completeness import Completeness
from aiplot.generated.card.region_position import RegionPosition
from aiplot.services import cards, works

router = APIRouter()

CardType = Literal["world", "character", "region", "main_story", "part", "episode"]


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
