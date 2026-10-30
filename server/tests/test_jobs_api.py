"""Jobs over HTTP: status, SSE stream with replay, pause / resume / cancel, auth."""

import asyncio
import json
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi import APIRouter, Depends, Request
from fastapi.testclient import TestClient

from aiplot.api.auth import require_token
from aiplot.generated.jobs.job_accepted import JobAccepted
from aiplot.jobs.queue import JobContext, JobQueue
from aiplot.main import API_PREFIX, create_app

TOKEN = "test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


async def quick(ctx: JobContext) -> dict[str, Any]:
    for i in range(3):
        ctx.progress(i + 1, 3, f"비트 {i + 1}")
    return {"chars": 5500}


async def slow(ctx: JobContext) -> None:
    for i in range(1000):
        await asyncio.sleep(0.01)
        ctx.progress(i + 1, 1000)
        await ctx.checkpoint()


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    app = create_app(token=TOKEN, db_path=tmp_path / "aiplot.db")
    probe = APIRouter(prefix=f"{API_PREFIX}/probe", dependencies=[Depends(require_token)])

    @probe.post("/jobs/{kind}", status_code=202)
    def start(request: Request, kind: str) -> JobAccepted:
        jobs: JobQueue = request.app.state.jobs
        job = jobs.submit(kind, quick if kind == "quick" else slow, work_id="w_1")
        return JobAccepted(jobId=job.id)

    app.include_router(probe)
    with TestClient(app) as c:
        yield c


def start(client: TestClient, kind: str) -> str:
    response = client.post(f"/api/v1/probe/jobs/{kind}", headers=AUTH)
    assert response.status_code == 202
    job_id: str = response.json()["jobId"]
    return job_id


def wait_status(client: TestClient, job_id: str, status: str, timeout: float = 3.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if client.get(f"/api/v1/jobs/{job_id}", headers=AUTH).json()["status"] == status:
            return
        time.sleep(0.01)
    raise AssertionError(f"job never reached {status}")


def read_events(client: TestClient, job_id: str, **headers: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    with client.stream("GET", f"/api/v1/jobs/{job_id}/events", headers=AUTH | headers) as r:
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/event-stream")
        current: dict[str, Any] = {}
        for line in r.iter_lines():
            if line.startswith("id: "):
                current["id"] = int(line[4:])
            elif line.startswith("event: "):
                current["event"] = line[7:]
            elif line.startswith("data: "):
                current["data"] = json.loads(line[6:])
            elif line == "" and current:
                events.append(current)
                current = {}
    return events


def test_unknown_job(client: TestClient) -> None:
    response = client.get("/api/v1/jobs/job_missing", headers=AUTH)
    assert response.status_code == 404
    assert response.json()["code"] == "JOB_NOT_FOUND"


def test_stream_to_done_and_replay(client: TestClient) -> None:
    job_id = start(client, "quick")
    events = read_events(client, job_id)
    assert [e["event"] for e in events] == ["progress", "progress", "progress", "done"]
    assert [e["id"] for e in events] == [1, 2, 3, 4]
    assert events[0]["data"] == {"done": 1, "total": 3, "etaSec": None, "step": "비트 1"}
    assert events[-1]["data"] == {"result": {"chars": 5500}}
    replay = read_events(client, job_id, **{"Last-Event-ID": "3"})
    assert [e["id"] for e in replay] == [4]
    job = client.get(f"/api/v1/jobs/{job_id}", headers=AUTH).json()
    assert (job["status"], job["lastEventId"], job["workId"]) == ("done", 4, "w_1")


def test_pause_resume_cancel(client: TestClient) -> None:
    job_id = start(client, "slow")
    wait_status(client, job_id, "running")
    assert client.post(f"/api/v1/jobs/{job_id}/pause", headers=AUTH).status_code == 200
    wait_status(client, job_id, "paused")
    response = client.post(f"/api/v1/jobs/{job_id}/pause", headers=AUTH)
    assert response.status_code == 409
    assert response.json()["code"] == "JOB_NOT_RUNNING"
    assert client.post(f"/api/v1/jobs/{job_id}/resume", headers=AUTH).status_code == 200
    wait_status(client, job_id, "running")
    assert client.post(f"/api/v1/jobs/{job_id}/cancel", headers=AUTH).status_code == 200
    wait_status(client, job_id, "cancelled")
    response = client.post(f"/api/v1/jobs/{job_id}/cancel", headers=AUTH)
    assert response.json()["code"] == "JOB_FINISHED"
    kinds = [e["event"] for e in read_events(client, job_id) if e["event"] != "progress"]
    assert kinds == ["paused", "resumed", "cancelled"]


def test_resume_needs_pause(client: TestClient) -> None:
    job_id = start(client, "slow")
    wait_status(client, job_id, "running")
    response = client.post(f"/api/v1/jobs/{job_id}/resume", headers=AUTH)
    assert (response.status_code, response.json()["code"]) == (409, "JOB_NOT_PAUSED")
    client.post(f"/api/v1/jobs/{job_id}/cancel", headers=AUTH)


def test_work_jobs_newest_first(client: TestClient) -> None:
    first = start(client, "quick")
    second = start(client, "quick")
    jobs = client.get("/api/v1/works/w_1/jobs", headers=AUTH).json()["jobs"]
    assert [j["jobId"] for j in jobs] == [second, first]
    assert client.get("/api/v1/works/w_2/jobs", headers=AUTH).json() == {"jobs": []}


def test_events_need_token(client: TestClient) -> None:
    job_id = start(client, "quick")
    assert client.get(f"/api/v1/jobs/{job_id}/events").status_code == 401
