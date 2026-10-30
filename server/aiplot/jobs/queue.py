"""In-memory job queue (§13): work keeps running across screen changes and streams events.

Jobs run in lanes. "llm" has one slot because llama-server has one (-np 1), so LLM calls never
queue inside llama-server; "download" runs beside it. Pause is cooperative and takes effect at
the job's next checkpoint (beat granularity); cancel stops the job at once, which also closes
any LLM stream it holds. Jobs live only in memory; their results are saved by the job itself.
"""

import asyncio
import logging
import secrets
from collections.abc import AsyncIterator, Callable, Coroutine
from dataclasses import dataclass, field
from datetime import UTC, datetime
from time import monotonic
from typing import Any, Literal

from aiplot.generated.jobs.events import JobErrorEvent
from aiplot.generated.jobs.job import Job

logger = logging.getLogger(__name__)

Lane = Literal["llm", "download"]
Status = Literal["queued", "running", "paused", "done", "failed", "cancelled"]
LANE_SLOTS: dict[Lane, int] = {"llm": 1, "download": 1}
TERMINAL: frozenset[Status] = frozenset({"done", "failed", "cancelled"})
KEEP_FINISHED = 100
# Idle seconds before an SSE stream gets a keep-alive comment.
HEARTBEAT_SEC = 15.0


class JobError(Exception):
    """Raised by a job function to fail with a code the UI maps to a state."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class JobEvent:
    id: int
    type: str
    data: dict[str, Any]


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


@dataclass
class JobRecord:
    id: str
    kind: str
    lane: Lane
    work_id: str | None
    fn: "JobFn"
    status: Status = "queued"
    created_at: str = field(default_factory=now)
    started_at: str | None = None
    finished_at: str | None = None
    error: JobErrorEvent | None = None
    events: list[JobEvent] = field(default_factory=list)
    task: "asyncio.Task[dict[str, Any] | None] | None" = None
    pause_requested: bool = False
    cancel_requested: bool = False
    resume: asyncio.Event = field(default_factory=asyncio.Event)
    changed: asyncio.Event = field(default_factory=asyncio.Event)

    def add_event(self, type: str, data: dict[str, Any]) -> None:
        self.events.append(JobEvent(len(self.events) + 1, type, data))
        # Wake every waiting subscriber, then arm a fresh event for the next change.
        self.changed.set()
        self.changed = asyncio.Event()

    def view(self) -> Job:
        return Job(
            jobId=self.id,
            kind=self.kind,
            workId=self.work_id,
            status=self.status,
            createdAt=self.created_at,
            startedAt=self.started_at,
            finishedAt=self.finished_at,
            lastEventId=len(self.events),
            error=self.error,
        )


class JobContext:
    """What a job function uses to report progress and honor pause."""

    def __init__(self, job: JobRecord) -> None:
        self._job = job
        self._first: tuple[float, int] | None = None

    @property
    def job_id(self) -> str:
        return self._job.id

    def emit(self, type: str, data: dict[str, Any]) -> None:
        self._job.add_event(type, data)

    def progress(self, done: int, total: int, step: str | None = None) -> None:
        """Emit progress with an ETA from the rate since the first report."""
        t = monotonic()
        if self._first is None:
            self._first = (t, done)
        start_t, start_done = self._first
        eta: float | None = None
        if done > start_done and t > start_t:
            rate = (done - start_done) / (t - start_t)
            eta = round(max(total - done, 0) / rate, 1)
        self.emit("progress", {"done": done, "total": total, "etaSec": eta, "step": step})

    async def checkpoint(self) -> None:
        """Safe stop point: blocks here while the job is paused."""
        job = self._job
        if not job.pause_requested:
            return
        job.resume.clear()
        job.status = "paused"
        self.emit("paused", {"reason": "user"})
        await job.resume.wait()
        job.status = "running"
        self.emit("resumed", {})


JobFn = Callable[[JobContext], Coroutine[Any, Any, dict[str, Any] | None]]


class JobQueue:
    def __init__(
        self, lane_slots: dict[Lane, int] = LANE_SLOTS, keep_finished: int = KEEP_FINISHED
    ) -> None:
        self._lane_slots = lane_slots
        self._keep_finished = keep_finished
        self._jobs: dict[str, JobRecord] = {}
        self._queues: dict[Lane, asyncio.Queue[JobRecord]] = {
            lane: asyncio.Queue() for lane in lane_slots
        }
        self._workers: list[asyncio.Task[None]] = []

    def start(self) -> None:
        for lane, slots in self._lane_slots.items():
            for _ in range(slots):
                self._workers.append(asyncio.create_task(self._work(lane)))

    async def stop(self) -> None:
        for worker in self._workers:
            worker.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        self._workers.clear()

    def submit(
        self, kind: str, fn: JobFn, *, lane: Lane = "llm", work_id: str | None = None
    ) -> JobRecord:
        job = JobRecord(f"job_{secrets.token_hex(8)}", kind, lane, work_id, fn)
        job.resume.set()
        self._jobs[job.id] = job
        self._queues[lane].put_nowait(job)
        return job

    def get(self, job_id: str) -> JobRecord | None:
        return self._jobs.get(job_id)

    def for_work(self, work_id: str) -> list[JobRecord]:
        return [job for job in reversed(self._jobs.values()) if job.work_id == work_id]

    def pause(self, job: JobRecord) -> bool:
        if job.status != "running":
            return False
        job.pause_requested = True
        return True

    def resume(self, job: JobRecord) -> bool:
        if job.status not in ("running", "paused") or not job.pause_requested:
            return False
        job.pause_requested = False
        job.resume.set()
        return True

    def cancel(self, job: JobRecord) -> bool:
        if job.status in TERMINAL:
            return False
        if job.status == "queued":
            # Still in its lane's queue; the worker skips it.
            self._finish(job, "cancelled", "cancelled", {})
            return True
        job.cancel_requested = True
        if job.task is not None:
            job.task.cancel()
        return True

    async def events(self, job: JobRecord, after: int = 0) -> AsyncIterator[JobEvent | None]:
        """Events after the given id, then live ones until the job ends. Yields None when
        nothing happened for `heartbeat` seconds so the caller can keep the stream alive."""
        cursor = after
        while True:
            waiter = job.changed
            while cursor < len(job.events):
                cursor += 1
                yield job.events[cursor - 1]
            if job.status in TERMINAL:
                return
            try:
                await asyncio.wait_for(waiter.wait(), timeout=HEARTBEAT_SEC)
            except TimeoutError:
                yield None

    async def _work(self, lane: Lane) -> None:
        queue = self._queues[lane]
        while True:
            job = await queue.get()
            if job.status == "queued":
                await self._run(job)

    async def _run(self, job: JobRecord) -> None:
        job.status = "running"
        job.started_at = now()
        job.task = asyncio.create_task(job.fn(JobContext(job)))
        try:
            result = await job.task
        except asyncio.CancelledError:
            current = asyncio.current_task()
            if current is not None and current.cancelling():
                # The queue is stopping: end the job with the worker.
                job.task.cancel()
                self._finish(job, "cancelled", "cancelled", {})
                raise
            self._finish(job, "cancelled", "cancelled", {})
        except JobError as exc:
            self._fail(job, exc.code, str(exc))
        except Exception:
            logger.exception("job %s (%s) crashed", job.id, job.kind)
            self._fail(job, "INTERNAL_ERROR", "the job stopped on an unexpected error")
        else:
            self._finish(job, "done", "done", {"result": result or {}})

    def _fail(self, job: JobRecord, code: str, message: str) -> None:
        error = JobErrorEvent(code=code, message=message)
        job.error = error
        self._finish(job, "failed", "error", error.model_dump())

    def _finish(self, job: JobRecord, status: Status, event: str, data: dict[str, Any]) -> None:
        job.status = status
        job.finished_at = now()
        job.add_event(event, data)
        finished = [j for j in self._jobs.values() if j.status in TERMINAL]
        for old in finished[: max(len(finished) - self._keep_finished, 0)]:
            del self._jobs[old.id]
