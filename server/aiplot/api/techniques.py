"""Direction technique cards (§16 direction: GET /techniques)."""

from fastapi import APIRouter

from aiplot.api.deps import Db
from aiplot.api.errors import AppError
from aiplot.generated.technique.technique import Technique
from aiplot.generated.technique.technique_list import TechniqueList
from aiplot.services import techniques

router = APIRouter()


@router.get("/techniques")
def list_techniques(db: Db, q: str | None = None) -> TechniqueList:
    return TechniqueList(techniques=techniques.search(db, q))


@router.get("/techniques/{techniqueId}")
def get_technique(db: Db, techniqueId: str) -> Technique:
    card = techniques.get(db, techniqueId)
    if card is None:
        raise AppError(404, "TECHNIQUE_NOT_FOUND", f"no technique {techniqueId}")
    return card
