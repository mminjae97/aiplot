"""Health endpoint: server up, llama-server state, VRAM."""

from fastapi import APIRouter, Request

from aiplot.generated.common.health import HealthResponse
from aiplot.llm import vram
from aiplot.llm.runtime import LlmRuntime

router = APIRouter()


@router.get("/health")
async def health(request: Request) -> HealthResponse:
    runtime: LlmRuntime = request.app.state.llm
    return HealthResponse(status="ok", llama=runtime.health(), vram=await vram.read())
