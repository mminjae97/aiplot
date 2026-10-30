"""Job status, SSE event stream, and pause / resume / cancel (§16).

Every route is async so it runs on the event loop thread: the queue's asyncio objects and its
check-then-act state changes are not thread-safe.
"""

import json
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import StreamingResponse

from aiplot.api.errors import AppError
from aiplot.generated.jobs.job import Job
from aiplot.generated.jobs.job_list import JobList
from aiplot.jobs.queue import JobQueue, JobRecord

router = APIRouter()


def queue(request: Request) -> JobQueue:
    jobs: JobQueue = request.app.state.jobs
    return jobs


def find(request: Request, job_id: str) -> JobRecord:
    job = queue(request).get(job_id)
    if job is None:
        raise AppError(404, "JOB_NOT_FOUND", f"no job {job_id}", hint="finished jobs expire")
    return job


@router.get("/jobs/{jobId}")
async def get_job(request: Request, jobId: str) -> Job:
    return find(request, jobId).view()


@router.get("/works/{workId}/jobs")
async def list_work_jobs(request: Request, workId: str) -> JobList:
    return JobList(jobs=[job.view() for job in queue(request).for_work(workId)])


def sse(event_id: int, event: str, data: object) -> str:
    return f"id: {event_id}\nevent: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.get("/jobs/{jobId}/events")
async def job_events(
    request: Request,
    jobId: str,
    last_event_id: Annotated[int | None, Header(alias="Last-Event-ID", ge=0)] = None,
    after: Annotated[int | None, Query(ge=0)] = None,
) -> StreamingResponse:
    """Replays events after Last-Event-ID (or ?after=), then streams until the job ends."""
    job = find(request, jobId)
    start = last_event_id if last_event_id is not None else (after or 0)

    async def stream() -> AsyncIterator[str]:
        async for event in queue(request).events(job, start):
            yield ": keep-alive\n\n" if event is None else sse(event.id, event.type, event.data)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/jobs/{jobId}/pause")
async def pause_job(request: Request, jobId: str) -> Job:
    job = find(request, jobId)
    if not queue(request).pause(job):
        raise AppError(409, "JOB_NOT_RUNNING", f"job is {job.status}; only running jobs pause")
    return job.view()


@router.post("/jobs/{jobId}/resume")
async def resume_job(request: Request, jobId: str) -> Job:
    job = find(request, jobId)
    if not queue(request).resume(job):
        raise AppError(409, "JOB_NOT_PAUSED", f"job is {job.status} and not paused")
    return job.view()


@router.post("/jobs/{jobId}/cancel")
async def cancel_job(request: Request, jobId: str) -> Job:
    job = find(request, jobId)
    if not queue(request).cancel(job):
        raise AppError(409, "JOB_FINISHED", f"job already {job.status}")
    return job.view()
