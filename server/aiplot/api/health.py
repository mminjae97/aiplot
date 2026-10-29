"""Health endpoint."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    # Response model comes from generated schemas (step 1, unit 2).
    return {"status": "ok"}
