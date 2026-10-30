import asyncio
from collections.abc import AsyncIterator
from typing import Any

import pytest

from aiplot.jobs import queue as queue_module
from aiplot.jobs.queue import JobContext, JobError, JobQueue, JobRecord

pytestmark = pytest.mark.anyio


@pytest.fixture
async def jobs() -> AsyncIterator[JobQueue]:
    q = JobQueue()
    q.start()
    yield q
    await q.stop()


async def settle(job: JobRecord, *statuses: str, timeout: float = 2.0) -> None:
    async with asyncio.timeout(timeout):
        while job.status not in statuses:
            await asyncio.sleep(0.005)


def types(job: JobRecord) -> list[str]:
    return [e.type for e in job.events]


async def test_job_runs_to_done(jobs: JobQueue) -> None:
    async def work(ctx: JobContext) -> dict[str, Any]:
        ctx.progress(1, 2)
        ctx.progress(2, 2)
        return {"chars": 5500}

    job = jobs.submit("chapter", work, work_id="w_1")
    await settle(job, "done")
    assert types(job) == ["progress", "progress", "done"]
    assert job.events[-1].data == {"result": {"chars": 5500}}
    view = job.view()
    assert (view.status, view.workId, view.lastEventId, view.error) == ("done", "w_1", 3, None)
    assert view.startedAt is not None and view.finishedAt is not None


async def test_llm_lane_runs_one_job_at_a_time(jobs: JobQueue) -> None:
    gate = asyncio.Event()
    order: list[str] = []

    def make(name: str) -> Any:
        async def work(ctx: JobContext) -> None:
            order.append(f"{name} start")
            await gate.wait()
            order.append(f"{name} end")

        return work

    first = jobs.submit("plan", make("a"))
    second = jobs.submit("plan", make("b"))
    download = jobs.submit("download", make("d"), lane="download")
    await settle(first, "running")
    await settle(download, "running")
    assert second.status == "queued"
    gate.set()
    await settle(second, "done")
    assert order.index("a end") < order.index("b start")


async def test_pause_waits_at_checkpoint_and_resumes(jobs: JobQueue) -> None:
    step = asyncio.Event()

    async def work(ctx: JobContext) -> None:
        for _ in range(2):
            await step.wait()
            step.clear()
            await ctx.checkpoint()

    job = jobs.submit("chapter", work)
    await settle(job, "running")
    assert jobs.pause(job)
    assert job.status == "running"  # takes effect at the next checkpoint
    step.set()
    await settle(job, "paused")
    assert types(job) == ["paused"]
    assert jobs.resume(job)
    await settle(job, "running")
    step.set()
    await settle(job, "done")
    assert types(job) == ["paused", "resumed", "done"]


async def test_cancel_stops_running_job_at_once(jobs: JobQueue) -> None:
    cleaned: list[bool] = []

    async def work(ctx: JobContext) -> None:
        try:
            await asyncio.sleep(60)
        finally:
            cleaned.append(True)

    job = jobs.submit("chapter", work)
    await settle(job, "running")
    assert jobs.cancel(job)
    await settle(job, "cancelled")
    assert cleaned == [True]
    assert types(job) == ["cancelled"]
    assert not jobs.cancel(job)


async def test_cancel_paused_job(jobs: JobQueue) -> None:
    async def work(ctx: JobContext) -> None:
        while True:
            await asyncio.sleep(0.005)
            await ctx.checkpoint()

    job = jobs.submit("chapter", work)
    await settle(job, "running")
    jobs.pause(job)
    await settle(job, "paused")
    jobs.cancel(job)
    await settle(job, "cancelled")


async def test_cancel_queued_job_never_runs(jobs: JobQueue) -> None:
    gate = asyncio.Event()
    ran: list[str] = []

    async def blocker(ctx: JobContext) -> None:
        await gate.wait()

    async def work(ctx: JobContext) -> None:
        ran.append("x")

    first = jobs.submit("plan", blocker)
    queued = jobs.submit("plan", work)
    assert jobs.cancel(queued)
    assert queued.status == "cancelled"
    gate.set()
    await settle(first, "done")
    await asyncio.sleep(0.02)
    assert ran == []


async def test_job_error_and_crash(jobs: JobQueue) -> None:
    async def fails(ctx: JobContext) -> None:
        raise JobError("LLM_UNAVAILABLE", "llama-server unreachable")

    async def crashes(ctx: JobContext) -> None:
        raise RuntimeError("boom")

    failed = jobs.submit("chapter", fails)
    crashed = jobs.submit("chapter", crashes)
    await settle(crashed, "failed")
    last = failed.events[-1]
    assert (last.type, last.data["code"]) == ("error", "LLM_UNAVAILABLE")
    error = crashed.view().error
    assert error is not None
    assert error.code == "INTERNAL_ERROR"


async def test_pause_and_resume_need_the_right_state(jobs: JobQueue) -> None:
    async def work(ctx: JobContext) -> None:
        return None

    job = jobs.submit("plan", work)
    await settle(job, "done")
    assert not jobs.pause(job)
    assert not jobs.resume(job)


async def test_events_replay_then_stream_live(jobs: JobQueue) -> None:
    go = asyncio.Event()

    async def work(ctx: JobContext) -> None:
        ctx.emit("beat_start", {"beatId": "b_1"})
        await go.wait()
        ctx.emit("beat_done", {"beatId": "b_1"})

    job = jobs.submit("chapter", work)
    await settle(job, "running")
    seen: list[tuple[int, str]] = []

    async def read() -> None:
        async for event in jobs.events(job, after=0):
            assert event is not None
            seen.append((event.id, event.type))

    reader = asyncio.create_task(read())
    await asyncio.sleep(0.02)
    go.set()
    await asyncio.wait_for(reader, 2)
    assert seen == [(1, "beat_start"), (2, "beat_done"), (3, "done")]
    late = [e.type async for e in jobs.events(job, after=2) if e is not None]
    assert late == ["done"]


async def test_events_heartbeat_when_idle(jobs: JobQueue, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(queue_module, "HEARTBEAT_SEC", 0.01)
    go = asyncio.Event()

    async def work(ctx: JobContext) -> None:
        await go.wait()

    job = jobs.submit("chapter", work)
    stream = jobs.events(job)
    assert await anext(stream) is None
    go.set()
    rest = [e async for e in stream]
    assert [e.type for e in rest if e is not None] == ["done"]


async def test_progress_eta(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = iter([100.0, 110.0, 120.0])
    monkeypatch.setattr(queue_module, "monotonic", lambda: next(clock))
    q = JobQueue()

    async def work(ctx: JobContext) -> None:
        return None

    job = q.submit("chapter", work)
    ctx = JobContext(job)
    ctx.progress(0, 8, "비트 1")
    ctx.progress(2, 8)
    ctx.progress(4, 8)
    etas = [e.data["etaSec"] for e in job.events]
    assert etas == [None, 30.0, 20.0]
    assert job.events[0].data["step"] == "비트 1"


async def test_finished_jobs_are_pruned() -> None:
    q = JobQueue(keep_finished=2)
    q.start()

    async def work(ctx: JobContext) -> None:
        return None

    made = [q.submit("plan", work) for _ in range(4)]
    await settle(made[-1], "done")
    assert [q.get(j.id) is not None for j in made] == [False, False, True, True]
    await q.stop()


async def test_stop_cancels_running_job() -> None:
    q = JobQueue()
    q.start()

    async def work(ctx: JobContext) -> None:
        await asyncio.sleep(60)

    job = q.submit("chapter", work)
    await settle(job, "running")
    await q.stop()
    assert job.status == "cancelled"


def test_job_error_code_must_be_upper_snake() -> None:
    with pytest.raises(ValueError, match="UPPER_SNAKE"):
        JobError("llm_down", "x")


async def test_lane_survives_a_job_that_breaks_outside_its_body(jobs: JobQueue) -> None:
    async def bad_code(ctx: JobContext) -> None:
        raise JobError("llm_down", "x")

    def not_a_coroutine(ctx: JobContext) -> Any:
        raise RuntimeError("raised before any await")

    async def fine(ctx: JobContext) -> None:
        return None

    broken = jobs.submit("chapter", bad_code)
    sync_raiser = jobs.submit("chapter", not_a_coroutine)
    after = jobs.submit("chapter", fine)
    await settle(after, "done")
    for job in (broken, sync_raiser):
        error = job.view().error
        assert (job.status, error and error.code) == ("failed", "INTERNAL_ERROR")
