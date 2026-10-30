"""Token check and ApiError bodies across /api/v1."""

from pathlib import Path

import pytest
from fastapi import APIRouter, Depends, FastAPI
from fastapi.testclient import TestClient

from aiplot.api.auth import require_token
from aiplot.api.errors import AppError
from aiplot.main import API_PREFIX, create_app

TOKEN = "test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


def app_with_probe_routes(db_path: Path) -> FastAPI:
    app = create_app(token=TOKEN, db_path=db_path)
    probe = APIRouter(prefix=f"{API_PREFIX}/probe", dependencies=[Depends(require_token)])

    @probe.get("/locked")
    def locked() -> None:
        raise AppError(423, "STAGE_LOCKED", "stage is locked", hint="reopen the stage")

    @probe.get("/count")
    def count(n: int) -> int:
        return n

    @probe.get("/crash")
    def crash() -> None:
        raise RuntimeError("boom")

    app.include_router(probe)
    return app


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    return TestClient(app_with_probe_routes(tmp_path / "aiplot.db"), raise_server_exceptions=False)


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Authorization": "Bearer wrong"},
        {"Authorization": f"Basic {TOKEN}"},
        {"Authorization": TOKEN},
        {"Authorization": f"Bearer {TOKEN}x"},
    ],
)
def test_health_rejects_missing_or_wrong_token(client: TestClient, headers: dict[str, str]) -> None:
    response = client.get("/api/v1/health", headers=headers)
    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"
    assert response.json() == {
        "code": "UNAUTHORIZED",
        "message": "missing or invalid bearer token",
        "hint": None,
    }


def test_scheme_is_case_insensitive(client: TestClient) -> None:
    response = client.get("/api/v1/health", headers={"Authorization": f"bearer {TOKEN}"})
    assert response.status_code == 200


def test_app_error_body(client: TestClient) -> None:
    response = client.get("/api/v1/probe/locked", headers=AUTH)
    assert response.status_code == 423
    assert response.json() == {
        "code": "STAGE_LOCKED",
        "message": "stage is locked",
        "hint": "reopen the stage",
    }


def test_auth_runs_before_validation(client: TestClient) -> None:
    response = client.get("/api/v1/probe/count?n=abc")
    assert response.status_code == 401


def test_validation_error_body(client: TestClient) -> None:
    response = client.get("/api/v1/probe/count?n=abc", headers=AUTH)
    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "VALIDATION_ERROR"
    assert body["message"].startswith("query.n: ")
    assert body["hint"] is None


def test_not_found_body(client: TestClient) -> None:
    response = client.get("/api/v1/nope", headers=AUTH)
    assert response.status_code == 404
    assert response.json() == {"code": "NOT_FOUND", "message": "Not Found", "hint": None}


def test_method_not_allowed_body(client: TestClient) -> None:
    response = client.post("/api/v1/health", headers=AUTH)
    assert response.status_code == 405
    assert response.headers["Allow"] == "GET"
    assert response.json()["code"] == "METHOD_NOT_ALLOWED"


def test_unhandled_error_body(client: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    response = client.get("/api/v1/probe/crash", headers=AUTH)
    assert response.status_code == 500
    assert response.json() == {
        "code": "INTERNAL_ERROR",
        "message": "internal server error",
        "hint": None,
    }
    assert "boom" in caplog.text
