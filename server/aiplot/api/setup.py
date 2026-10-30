"""First-run setup (S0-1): status, download job, user paths, llama retry."""

from typing import Any

from fastapi import APIRouter, Request, Response

from aiplot.api.errors import AppError
from aiplot.generated.jobs.job_accepted import JobAccepted
from aiplot.generated.setup.paths_request import SetupPathsRequest
from aiplot.generated.setup.status import SetupStatus
from aiplot.jobs.queue import TERMINAL, JobContext, JobQueue
from aiplot.llm.runtime import LlmRuntime
from aiplot.services.setup import Setup

router = APIRouter()


def services(request: Request) -> tuple[Setup, JobQueue, LlmRuntime]:
    runtime: LlmRuntime = request.app.state.llm
    jobs: JobQueue = request.app.state.jobs
    return runtime.setup, jobs, runtime


def running_job(setup: Setup, jobs: JobQueue) -> str | None:
    """The setup job still in progress, if any (and forget finished ones)."""
    job = jobs.get(setup.job_id) if setup.job_id else None
    if job is None or job.status in TERMINAL:
        setup.job_id = setup.job_kind = None
        return None
    return job.id


@router.get("/setup")
async def setup_status(request: Request) -> SetupStatus:
    setup, jobs, _ = services(request)
    running_job(setup, jobs)
    return setup.status()


@router.post("/setup/download", status_code=202)
async def start_download(request: Request) -> JobAccepted:
    setup, jobs, _ = services(request)
    current = running_job(setup, jobs)
    if current is not None:
        if setup.job_kind == "download":
            # Pressing download again shows the same progress.
            return JobAccepted(jobId=current)
        raise AppError(409, "SETUP_BUSY", "a path check is running")
    if setup.llama_installed() and setup.model_installed():
        raise AppError(409, "SETUP_COMPLETE", "llama.cpp and the base model are already installed")
    job = jobs.submit("download", setup.download, lane="download")
    setup.job_id, setup.job_kind = job.id, job.kind
    return JobAccepted(jobId=job.id)


@router.put("/setup/paths", status_code=202)
async def set_paths(request: Request, body: SetupPathsRequest) -> JobAccepted:
    setup, jobs, _ = services(request)
    if running_job(setup, jobs) is not None:
        raise AppError(409, "SETUP_BUSY", "a download or path check is running")

    async def check(ctx: JobContext) -> dict[str, Any]:
        return await setup.set_paths(ctx, body.model_path, body.llama_dir)

    job = jobs.submit("verify_paths", check, lane="download")
    setup.job_id, setup.job_kind = job.id, job.kind
    return JobAccepted(jobId=job.id)


@router.post("/setup/retry", status_code=204)
async def retry_llama(request: Request) -> Response:
    """ "다시 시도" after llama-server gave up (§12): start again with a fresh restart budget."""
    _, _, runtime = services(request)
    if runtime.process is not None:
        runtime.process.retry()
    return Response(status_code=204)
