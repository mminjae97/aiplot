"""책 꾸미기 over HTTP: book colour, cover uploads, picking and deleting covers (§12 S0)."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from aiplot.db.migrate import init_db
from aiplot.main import create_app
from aiplot.services.covers import MAX_BYTES

TOKEN = "test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
WEBP = {**AUTH, "Content-Type": "image/webp"}
# The server checks only the RIFF/WEBP header; the app encodes the real image.
IMAGE = b"RIFF\x1a\x00\x00\x00WEBPVP8L\x0d\x00\x00\x00/\x00\x00\x00\x10\x07\x10\x11\x11\x88\x88"


@pytest.fixture
def images(tmp_path: Path) -> Path:
    return tmp_path / "images"


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    db_path = tmp_path / "data" / "aiplot.db"
    init_db(db_path)
    return TestClient(create_app(token=TOKEN, db_path=db_path))


def create(client: TestClient, title: str = "안개의 항구") -> dict[str, object]:
    response = client.post("/api/v1/works", headers=AUTH, json={"title": title})
    assert response.status_code == 201, response.json()
    work: dict[str, object] = response.json()
    return work


def upload(client: TestClient, work_id: object, data: bytes = IMAGE) -> dict[str, object]:
    response = client.post(f"/api/v1/works/{work_id}/covers", headers=WEBP, content=data)
    assert response.status_code == 201, response.json()
    cover: dict[str, object] = response.json()
    return cover


def patch(client: TestClient, work_id: object, body: dict[str, object]) -> dict[str, object]:
    response = client.patch(f"/api/v1/works/{work_id}", headers=AUTH, json=body)
    assert response.status_code == 200, response.json()
    work: dict[str, object] = response.json()
    return work


def covers_of(client: TestClient, work_id: object) -> list[dict[str, object]]:
    response = client.get(f"/api/v1/works/{work_id}/covers", headers=AUTH)
    assert response.status_code == 200, response.json()
    covers: list[dict[str, object]] = response.json()["covers"]
    return covers


def stored(images: Path) -> list[str]:
    folder = images / "covers"
    return sorted(p.name for p in folder.iterdir()) if folder.exists() else []


def test_new_book_has_default_cloth(client: TestClient) -> None:
    work = create(client)
    assert (work["color"], work["cover_id"]) == (None, None)


def test_color_keeps_shelf_order(client: TestClient) -> None:
    old, new = create(client, "먼저"), create(client, "나중")
    work = patch(client, old["id"], {"color": "#6e2c28"})
    assert (work["color"], work["updated_at"]) == ("#6e2c28", old["updated_at"])
    works = client.get("/api/v1/works", headers=AUTH).json()["works"]
    assert [w["id"] for w in works] == [new["id"], old["id"]]
    assert patch(client, old["id"], {"color": None})["color"] is None


@pytest.mark.parametrize(
    "body",
    [{}, {"color": "#ABCDEF"}, {"color": "#fff"}, {"color": "red"}, {"title": "새 제목"}],
)
def test_update_rejects(client: TestClient, body: dict[str, object]) -> None:
    work = create(client)
    response = client.patch(f"/api/v1/works/{work['id']}", headers=AUTH, json=body)
    assert (response.status_code, response.json()["code"]) == (422, "VALIDATION_ERROR")


def test_update_missing_work(client: TestClient) -> None:
    response = client.patch("/api/v1/works/w_nope", headers=AUTH, json={"color": None})
    assert (response.status_code, response.json()["code"]) == (404, "WORK_NOT_FOUND")


def test_upload_list_and_serve(client: TestClient, images: Path) -> None:
    work = create(client)
    first, second = upload(client, work["id"]), upload(client, work["id"], IMAGE + b"\x00")
    assert str(first["id"]).startswith("cv_")
    assert first["work_id"] == work["id"]
    assert covers_of(client, work["id"]) == [first, second]
    image = client.get(f"/api/v1/works/{work['id']}/covers/{first['id']}/image", headers=AUTH)
    assert (image.status_code, image.headers["content-type"]) == (200, "image/webp")
    assert image.content == IMAGE
    assert stored(images) == sorted([f"{first['id']}.webp", f"{second['id']}.webp"])


def test_pick_cover_and_change_color_independently(client: TestClient) -> None:
    work = create(client)
    cover = upload(client, work["id"])
    assert patch(client, work["id"], {"cover_id": cover["id"]})["cover_id"] == cover["id"]
    work = patch(client, work["id"], {"color": "#2f4a3a"})
    assert (work["color"], work["cover_id"]) == ("#2f4a3a", cover["id"])
    assert patch(client, work["id"], {"cover_id": None})["cover_id"] is None


@pytest.mark.parametrize("theirs", [True, False])
def test_cover_must_belong_to_the_book(client: TestClient, theirs: bool) -> None:
    mine, other = create(client, "내 책"), create(client, "남의 책")
    cover_id = upload(client, other["id"])["id"] if theirs else "cv_nope"
    base = f"/api/v1/works/{mine['id']}"
    for method, path, body in (
        ("PATCH", base, {"cover_id": cover_id}),
        ("GET", f"{base}/covers/{cover_id}/image", None),
        ("DELETE", f"{base}/covers/{cover_id}", None),
    ):
        response = client.request(method, path, headers=AUTH, json=body)
        assert (response.status_code, response.json()["code"]) == (404, "COVER_NOT_FOUND")
    assert len(covers_of(client, other["id"])) == (1 if theirs else 0)


def test_rejected_cover_keeps_color_unchanged(client: TestClient) -> None:
    work = create(client)
    body = {"color": "#6e2c28", "cover_id": "cv_nope"}
    response = client.patch(f"/api/v1/works/{work['id']}", headers=AUTH, json=body)
    assert response.status_code == 404
    assert client.get(f"/api/v1/works/{work['id']}", headers=AUTH).json()["color"] is None


def test_deleting_cover_in_use_falls_back_to_cloth(client: TestClient, images: Path) -> None:
    work = create(client)
    cover = upload(client, work["id"])
    patch(client, work["id"], {"color": "#2c3a55", "cover_id": cover["id"]})
    response = client.delete(f"/api/v1/works/{work['id']}/covers/{cover['id']}", headers=AUTH)
    assert response.status_code == 204
    reopened = client.get(f"/api/v1/works/{work['id']}", headers=AUTH).json()
    assert (reopened["color"], reopened["cover_id"]) == ("#2c3a55", None)
    assert covers_of(client, work["id"]) == []
    assert stored(images) == []
    gone = client.get(f"/api/v1/works/{work['id']}/covers/{cover['id']}/image", headers=AUTH)
    assert gone.status_code == 404


@pytest.mark.parametrize(
    ("data", "status", "code"),
    [
        (b"\x89PNG\r\n\x1a\n" + b"\x00" * 32, 415, "COVER_UNSUPPORTED"),
        (b"RIFF\x00\x00\x00\x00WEBP", 415, "COVER_UNSUPPORTED"),
        (IMAGE + b"\x00" * MAX_BYTES, 413, "COVER_TOO_LARGE"),
        (b"", 422, "VALIDATION_ERROR"),
    ],
)
def test_upload_rejects(
    client: TestClient, images: Path, data: bytes, status: int, code: str
) -> None:
    work = create(client)
    response = client.post(f"/api/v1/works/{work['id']}/covers", headers=WEBP, content=data)
    assert (response.status_code, response.json()["code"]) == (status, code)
    assert covers_of(client, work["id"]) == []
    assert stored(images) == []


def test_upload_to_missing_work(client: TestClient, images: Path) -> None:
    response = client.post("/api/v1/works/w_nope/covers", headers=WEBP, content=IMAGE)
    assert (response.status_code, response.json()["code"]) == (404, "WORK_NOT_FOUND")
    listing = client.get("/api/v1/works/w_nope/covers", headers=AUTH)
    assert (listing.status_code, listing.json()["code"]) == (404, "WORK_NOT_FOUND")
    assert stored(images) == []


def test_cover_routes_need_token(client: TestClient) -> None:
    work = create(client)
    cover = upload(client, work["id"])
    base = f"/api/v1/works/{work['id']}"
    assert client.get(f"{base}/covers").status_code == 401
    assert client.get(f"{base}/covers/{cover['id']}/image").status_code == 401
    assert client.post(f"{base}/covers", content=IMAGE).status_code == 401
    assert client.delete(f"{base}/covers/{cover['id']}").status_code == 401
    assert client.patch(base, json={"color": None}).status_code == 401
