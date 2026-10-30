"""Library books over HTTP: create, list newest first, open."""

import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from aiplot.db.migrate import init_db
from aiplot.main import create_app

TOKEN = "test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    db_path = tmp_path / "data" / "aiplot.db"
    init_db(db_path)
    return TestClient(create_app(token=TOKEN, db_path=db_path))


def create(client: TestClient, title: str) -> dict[str, object]:
    response = client.post("/api/v1/works", headers=AUTH, json={"title": title})
    assert response.status_code == 201, response.json()
    work: dict[str, object] = response.json()
    return work


def test_empty_library(client: TestClient) -> None:
    assert client.get("/api/v1/works", headers=AUTH).json() == {"works": []}


def test_create_starts_in_planning(client: TestClient) -> None:
    work = create(client, "  안개의   항구  ")
    assert work["title"] == "안개의 항구"
    assert (work["stage"], work["locked_stage"], work["last_item"]) == (1, 0, None)
    assert str(work["id"]).startswith("w_")
    assert str(work["updated_at"]).endswith("Z")


def test_list_is_newest_first(client: TestClient) -> None:
    first = create(client, "첫 책")
    time.sleep(0.01)
    second = create(client, "둘째 책")
    works = client.get("/api/v1/works", headers=AUTH).json()["works"]
    assert [w["id"] for w in works] == [second["id"], first["id"]]


def test_open_one(client: TestClient) -> None:
    work = create(client, "안개의 항구")
    assert client.get(f"/api/v1/works/{work['id']}", headers=AUTH).json() == work
    missing = client.get("/api/v1/works/w_nope", headers=AUTH)
    assert (missing.status_code, missing.json()["code"]) == (404, "WORK_NOT_FOUND")


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"title": "   "}, "TITLE_EMPTY"),
        ({"title": ""}, "VALIDATION_ERROR"),
        ({"title": "가" * 101}, "VALIDATION_ERROR"),
        ({}, "VALIDATION_ERROR"),
        ({"title": "책", "stage": 3}, "VALIDATION_ERROR"),
    ],
)
def test_create_rejects(client: TestClient, body: dict[str, object], code: str) -> None:
    response = client.post("/api/v1/works", headers=AUTH, json=body)
    assert (response.status_code, response.json()["code"]) == (422, code)


def test_works_need_token(client: TestClient) -> None:
    assert client.get("/api/v1/works").status_code == 401
