"""/setup routes against the local file server from test_setup."""

import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from aiplot.llm.config import load_llm_config
from aiplot.llm.fake import FakeClient
from aiplot.llm.router import Router
from aiplot.llm.runtime import LlmRuntime
from aiplot.main import create_app
from aiplot.services.setup import Setup
from tests.test_setup import MODEL, Files, files, pins

__all__ = ["files"]  # fixture used by this module

TOKEN = "test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def client(tmp_path: Path, files: tuple[Files, str]) -> Iterator[TestClient]:
    build, profile = pins(files[1])
    setup = Setup(tmp_path, build, profile)
    router = Router(load_llm_config(), FakeClient(), lora_dir=tmp_path / "lora")
    app = create_app(
        token=TOKEN, db_path=tmp_path / "data" / "aiplot.db", llm=LlmRuntime(router, setup)
    )
    with TestClient(app) as c:
        yield c


def wait_job(client: TestClient, job_id: str) -> dict[str, object]:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        job: dict[str, object] = client.get(f"/api/v1/jobs/{job_id}", headers=AUTH).json()
        if job["status"] in ("done", "failed", "cancelled"):
            return job
        time.sleep(0.02)
    raise AssertionError("job did not finish")


def test_first_run_download_flow(client: TestClient) -> None:
    status = client.get("/api/v1/setup", headers=AUTH).json()
    assert [i["status"] for i in status["items"]] == ["missing", "missing"]
    assert status["job_id"] is None
    response = client.post("/api/v1/setup/download", headers=AUTH)
    assert response.status_code == 202
    job_id = response.json()["jobId"]
    assert wait_job(client, job_id)["status"] == "done"
    status = client.get("/api/v1/setup", headers=AUTH).json()
    assert [i["status"] for i in status["items"]] == ["installed", "installed"]
    assert (status["remaining_bytes"], status["job_id"]) == (0, None)
    again = client.post("/api/v1/setup/download", headers=AUTH)
    assert (again.status_code, again.json()["code"]) == (409, "SETUP_COMPLETE")


def test_set_paths_runs_a_check_job(client: TestClient, tmp_path: Path) -> None:
    response = client.put(
        "/api/v1/setup/paths",
        headers=AUTH,
        json={"model_path": str(tmp_path / "missing.gguf"), "llama_dir": None},
    )
    assert response.status_code == 202
    job = wait_job(client, response.json()["jobId"])
    assert job["status"] == "failed"
    assert job["error"] == {
        "code": "MODEL_NOT_FOUND",
        "message": f"{tmp_path / 'missing.gguf'} is not a file",
    }


def test_set_paths_needs_both_keys(client: TestClient) -> None:
    response = client.put("/api/v1/setup/paths", headers=AUTH, json={"model_path": None})
    assert (response.status_code, response.json()["code"]) == (422, "VALIDATION_ERROR")


def test_retry_and_auth(client: TestClient) -> None:
    assert client.post("/api/v1/setup/retry", headers=AUTH).status_code == 204
    assert client.get("/api/v1/setup").status_code == 401


def test_download_while_a_path_check_runs_is_busy(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def slow_hash(*args: object) -> str:
        time.sleep(1.0)
        return ""

    monkeypatch.setattr("aiplot.services.setup.sha256_of", slow_hash)
    mine = tmp_path / "mine.gguf"
    mine.write_bytes(MODEL)
    response = client.put(
        "/api/v1/setup/paths", headers=AUTH, json={"model_path": str(mine), "llama_dir": None}
    )
    assert response.status_code == 202
    busy = client.post("/api/v1/setup/download", headers=AUTH)
    assert (busy.status_code, busy.json()["code"]) == (409, "SETUP_BUSY")
    wait_job(client, response.json()["jobId"])
