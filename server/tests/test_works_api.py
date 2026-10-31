"""Library books over HTTP: create, list newest first, open, rename, delete."""

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
    # Same-millisecond creations (coarse Windows clock) still list newest first.
    made = [create(client, f"책 {n}")["id"] for n in range(5)]
    works = client.get("/api/v1/works", headers=AUTH).json()["works"]
    assert [w["id"] for w in works] == made[::-1]


def test_title_fits_after_collapsing(client: TestClient) -> None:
    assert create(client, "가" * 100 + " \n")["title"] == "가" * 100


def test_open_one(client: TestClient) -> None:
    work = create(client, "안개의 항구")
    assert client.get(f"/api/v1/works/{work['id']}", headers=AUTH).json() == work
    missing = client.get("/api/v1/works/w_nope", headers=AUTH)
    assert (missing.status_code, missing.json()["code"]) == (404, "WORK_NOT_FOUND")


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"title": "   "}, "TITLE_EMPTY"),
        ({"title": ""}, "TITLE_EMPTY"),
        ({"title": "가" * 101}, "TITLE_TOO_LONG"),
        ({"title": "가" * 1001}, "VALIDATION_ERROR"),
        ({}, "VALIDATION_ERROR"),
        ({"title": "책", "stage": 3}, "VALIDATION_ERROR"),
    ],
)
def test_create_rejects(client: TestClient, body: dict[str, object], code: str) -> None:
    response = client.post("/api/v1/works", headers=AUTH, json=body)
    assert (response.status_code, response.json()["code"]) == (422, code)


def test_works_need_token(client: TestClient) -> None:
    assert client.get("/api/v1/works").status_code == 401


def test_rename_keeps_shelf_order(client: TestClient) -> None:
    old, new = create(client, "먼저"), create(client, "나중")
    response = client.patch(
        f"/api/v1/works/{old['id']}", headers=AUTH, json={"title": "  안개   낀 항구 "}
    )
    assert response.status_code == 200, response.json()
    renamed = response.json()
    assert (renamed["title"], renamed["updated_at"]) == ("안개 낀 항구", old["updated_at"])
    works = client.get("/api/v1/works", headers=AUTH).json()["works"]
    assert [w["id"] for w in works] == [new["id"], old["id"]]


@pytest.mark.parametrize(
    ("title", "code"), [("   ", "TITLE_EMPTY"), ("가" * 101, "TITLE_TOO_LONG")]
)
def test_rename_rejects(client: TestClient, title: str, code: str) -> None:
    work = create(client, "안개의 항구")
    body = {"title": title, "color": "#2f4a3a"}
    response = client.patch(f"/api/v1/works/{work['id']}", headers=AUTH, json=body)
    assert (response.status_code, response.json()["code"]) == (422, code)
    # Nothing else in the request applied either.
    assert client.get(f"/api/v1/works/{work['id']}", headers=AUTH).json() == work


def test_rename_rejects_null_title(client: TestClient) -> None:
    work = create(client, "안개의 항구")
    response = client.patch(f"/api/v1/works/{work['id']}", headers=AUTH, json={"title": None})
    assert (response.status_code, response.json()["code"]) == (422, "VALIDATION_ERROR")


def test_unknown_cover_rolls_back_the_title(client: TestClient) -> None:
    work = create(client, "안개의 항구")
    body = {"title": "새 제목", "cover_id": "cv_nope"}
    response = client.patch(f"/api/v1/works/{work['id']}", headers=AUTH, json=body)
    assert (response.status_code, response.json()["code"]) == (404, "COVER_NOT_FOUND")
    assert client.get(f"/api/v1/works/{work['id']}", headers=AUTH).json() == work


def test_rename_missing_work(client: TestClient) -> None:
    response = client.patch("/api/v1/works/w_nope", headers=AUTH, json={"title": "책"})
    assert (response.status_code, response.json()["code"]) == (404, "WORK_NOT_FOUND")


def test_delete_removes_the_book_and_its_covers(client: TestClient, tmp_path: Path) -> None:
    keep, gone = create(client, "남는 책"), create(client, "지울 책")
    webp = {**AUTH, "Content-Type": "image/webp"}
    image = b"RIFF\x10\x00\x00\x00WEBPVP8L\x00\x00"
    uploads = {}
    for work in (keep, gone):
        response = client.post(f"/api/v1/works/{work['id']}/covers", headers=webp, content=image)
        assert response.status_code == 201, response.json()
        uploads[work["id"]] = response.json()["id"]
    client.patch(
        f"/api/v1/works/{gone['id']}", headers=AUTH, json={"cover_id": uploads[gone["id"]]}
    )

    assert client.delete(f"/api/v1/works/{gone['id']}", headers=AUTH).status_code == 204
    works = client.get("/api/v1/works", headers=AUTH).json()["works"]
    assert [w["id"] for w in works] == [keep["id"]]
    missing = client.get(f"/api/v1/works/{gone['id']}/covers", headers=AUTH)
    assert (missing.status_code, missing.json()["code"]) == (404, "WORK_NOT_FOUND")
    files = sorted(p.name for p in (tmp_path / "images" / "covers").iterdir())
    assert files == [f"{uploads[keep['id']]}.webp"]


def test_delete_missing_work(client: TestClient) -> None:
    response = client.delete("/api/v1/works/w_nope", headers=AUTH)
    assert (response.status_code, response.json()["code"]) == (404, "WORK_NOT_FOUND")
    assert client.delete("/api/v1/works/w_nope").status_code == 401
