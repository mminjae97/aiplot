"""Health endpoint."""

from fastapi import APIRouter

from aiplot.generated.common.health import HealthResponse

router = APIRouter()


@router.get("/health")
def health() -> HealthResponse:
    return HealthResponse(status="ok")
