"""Technique cards (§9): the catalog files, their load into the database, GET /techniques."""

import json
import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from aiplot.db.connection import connect
from aiplot.db.migrate import init_db
from aiplot.generated.technique.technique import Technique
from aiplot.main import API_PREFIX, create_app, load_techniques
from aiplot.services import techniques
from aiplot.services.techniques import TECHNIQUES_DIR, TechniqueDataError

TOKEN = "test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
CATALOG = techniques.load()


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    path = tmp_path / "data" / "aiplot.db"
    init_db(path)
    return path


@pytest.fixture
def conn(db_path: Path) -> Iterator[sqlite3.Connection]:
    conn = connect(db_path)
    yield conn
    conn.close()


@pytest.fixture
def client(db_path: Path) -> TestClient:
    load_techniques(db_path)
    return TestClient(create_app(token=TOKEN, db_path=db_path))


def card(category: str, number: int, **changes: Any) -> dict[str, Any]:
    """A real card under another id."""
    base = CATALOG[0].model_dump(mode="json")
    return {
        **base,
        "id": f"tech_{category}_{number:03d}",
        "category": category,
        "pairs_with": [],
        "conflicts_with": [],
        **changes,
    }


def write(folder: Path, files: dict[str, list[dict[str, Any]]]) -> Path:
    folder.mkdir()
    for name, cards in files.items():
        (folder / f"{name}.json").write_text(json.dumps(cards, ensure_ascii=False), "utf-8")
    return folder


def test_the_catalog_is_whole() -> None:
    assert len(CATALOG) == 320
    assert {t.category for t in CATALOG} == {"rhe", "str", "tim", "voi", "inf", "cha", "des", "ser"}
    assert {p.stem for p in TECHNIQUES_DIR.glob("*.json")} == {t.category for t in CATALOG}
    by_id = {t.id: t for t in CATALOG}
    assert by_id["tech_ser_001"].name == "인 메디아스 레스"
    # Tags are unique per card (the schema says so; pydantic lists do not check it).
    for t in CATALOG:
        for tags in (t.scope, t.effects, t.situations, t.pairs_with, t.conflicts_with):
            assert len(set(tags)) == len(tags), t.id
    # The serial cards direct always gets for chapter cuts (§9).
    names = {t.name for t in CATALOG}
    assert {"회차 끝 절단", "회차 3단 설계", "전회 연결 도입", "사이다/고구마 완급"} <= names


@pytest.mark.parametrize(
    ("files", "message"),
    [
        ({"ser": [card("ser", 1, pairs_with=["tech_ser_009"])]}, "bad reference"),
        ({"ser": [card("ser", 1, conflicts_with=["tech_ser_001"])]}, "bad reference"),
        ({"ser": [card("str", 1)]}, "not of this category"),
        ({"ser": [card("ser", 1), card("ser", 1)]}, "duplicate"),
        (
            {
                "ser": [
                    card("ser", 1, pairs_with=["tech_ser_002"]),
                    card("ser", 2, conflicts_with=["tech_ser_001"]),
                ]
            },
            "both pairs and conflicts",
        ),
        ({"ser": [card("ser", 1, effects=["두근거림"])]}, "ser.json"),
        ({}, "no technique cards"),
    ],
)
def test_broken_catalogs_are_refused(
    tmp_path: Path, files: dict[str, list[dict[str, Any]]], message: str
) -> None:
    with pytest.raises(TechniqueDataError, match=message):
        techniques.load(write(tmp_path / "techniques", files))


def test_sync_mirrors_the_files_and_keeps_rows_of_cards_still_there(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    first = techniques.load(
        write(
            tmp_path / "a",
            {
                "ser": [
                    card("ser", 1, pairs_with=["tech_ser_002"]),
                    card("ser", 2, conflicts_with=["tech_ser_003"]),
                    card("ser", 3),
                ]
            },
        )
    )
    techniques.sync(conn, first)
    rowid = conn.execute("SELECT rowid FROM technique_card WHERE id = 'tech_ser_001'").fetchone()[0]
    relations = conn.execute(
        "SELECT from_id, to_id, kind FROM technique_relation ORDER BY 3, 1, 2"
    ).fetchall()
    # Conflicts are stored both ways; pairs as listed.
    assert [tuple(r) for r in relations] == [
        ("tech_ser_002", "tech_ser_003", "conflicts"),
        ("tech_ser_003", "tech_ser_002", "conflicts"),
        ("tech_ser_001", "tech_ser_002", "pairs"),
    ]
    tags = conn.execute(
        "SELECT kind, count(*) FROM technique_tag WHERE technique_id = 'tech_ser_001' GROUP BY 1"
    ).fetchall()
    assert dict(tags) == {
        "scope": len(CATALOG[0].scope),
        "effect": len(CATALOG[0].effects),
        "situation": len(CATALOG[0].situations),
    }

    # A card left out of the files goes; the others keep their rows.
    second = techniques.load(write(tmp_path / "b", {"ser": [card("ser", 1, name="바뀐 이름")]}))
    techniques.sync(conn, second)
    assert [r[0] for r in conn.execute("SELECT id FROM technique_card")] == ["tech_ser_001"]
    row = conn.execute("SELECT rowid, name FROM technique_card").fetchone()
    assert tuple(row) == (rowid, "바뀐 이름")
    assert conn.execute("SELECT count(*) FROM technique_relation").fetchone()[0] == 0


def test_list_search_and_read(client: TestClient) -> None:
    listed = client.get(f"{API_PREFIX}/techniques", headers=AUTH).json()["techniques"]
    assert len(listed) == 320
    assert [t["id"] for t in listed] == sorted(t["id"] for t in listed)
    assert set(listed[0]) == {
        "id",
        "category",
        "name",
        "name_en",
        "scope",
        "effects",
        "situations",
        "description",
    }

    def found(q: str) -> list[str]:
        response = client.get(f"{API_PREFIX}/techniques", params={"q": q}, headers=AUTH)
        return [t["name"] for t in response.json()["techniques"]]

    assert "외적 회상" in found("회상")
    assert found("인메디아스") == ["인 메디아스 레스"]  # spacing ignored
    assert found("IN MEDIAS") == ["인 메디아스 레스"]  # English name, case ignored
    assert "직접 제시" in found("텔링")  # an alias
    assert found("없는 기법") == []

    full = client.get(f"{API_PREFIX}/techniques/tech_ser_001", headers=AUTH).json()
    assert Technique.model_validate(full) == next(t for t in CATALOG if t.id == "tech_ser_001")


def test_unknown_technique_and_token(client: TestClient) -> None:
    missing = client.get(f"{API_PREFIX}/techniques/tech_ser_999", headers=AUTH)
    assert missing.status_code == 404
    assert missing.json()["code"] == "TECHNIQUE_NOT_FOUND"
    assert client.get(f"{API_PREFIX}/techniques").status_code == 401
