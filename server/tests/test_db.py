import sqlite3
from pathlib import Path

import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient

from aiplot.api.deps import Db
from aiplot.db.connection import BUSY_TIMEOUT_MS, connect, transaction
from aiplot.db.migrate import (
    MIGRATIONS_DIR,
    MigrationError,
    discover,
    init_db,
    migrate,
    user_version,
)
from aiplot.main import API_PREFIX, create_app

TOKEN = "test-token"


def write(directory: Path, files: dict[str, str]) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    for name, sql in files.items():
        (directory / name).write_text(sql, encoding="utf-8")
    return directory


def tables(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute("SELECT name FROM sqlite_schema WHERE type = 'table'").fetchall()
    return {row["name"] for row in rows}


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    return connect(tmp_path / "aiplot.db")


def test_shipped_migrations_are_unique_and_contiguous() -> None:
    discover(MIGRATIONS_DIR)


def test_discover_orders_by_number_and_ignores_other_files(tmp_path: Path) -> None:
    directory = write(
        tmp_path,
        {"002_b.sql": "", "001_a.sql": "", "010_notes.txt": "", ".gitkeep": ""},
    )
    assert [m.path.name for m in discover(directory)] == ["001_a.sql", "002_b.sql"]
    assert [m.version for m in discover(directory)] == [1, 2]


@pytest.mark.parametrize(
    "names",
    [
        ["001_a.sql", "001_b.sql"],
        ["001_a.sql", "003_c.sql"],
        ["002_b.sql"],
        ["1_a.sql"],
        ["001-a.sql"],
        ["001_Card.sql"],
        ["0001_a.sql"],
        ["001_.sql"],
    ],
)
def test_discover_rejects_bad_sets(tmp_path: Path, names: list[str]) -> None:
    directory = write(tmp_path, dict.fromkeys(names, ""))
    with pytest.raises(MigrationError):
        discover(directory)


def test_migrate_applies_in_order_and_is_idempotent(
    tmp_path: Path, conn: sqlite3.Connection
) -> None:
    migrations = discover(
        write(
            tmp_path / "m",
            {
                "001_work.sql": "CREATE TABLE work (id TEXT PRIMARY KEY);",
                "002_card.sql": "CREATE TABLE card (id TEXT PRIMARY KEY,"
                " work_id TEXT REFERENCES work(id))\n-- trailing comment",
            },
        )
    )
    assert migrate(conn, migrations) == 2
    assert user_version(conn) == 2
    assert {"work", "card"} <= tables(conn)
    assert migrate(conn, migrations) == 2


def test_migrate_resumes_from_current_version(tmp_path: Path, conn: sqlite3.Connection) -> None:
    directory = write(tmp_path / "m", {"001_work.sql": "CREATE TABLE work (id TEXT);"})
    migrate(conn, discover(directory))
    write(directory, {"002_card.sql": "CREATE TABLE card (id TEXT);"})
    assert migrate(conn, discover(directory)) == 2
    assert {"work", "card"} <= tables(conn)


def test_failed_migration_rolls_back_whole_file(tmp_path: Path, conn: sqlite3.Connection) -> None:
    migrations = discover(
        write(
            tmp_path / "m",
            {
                "001_work.sql": "CREATE TABLE work (id TEXT);",
                "002_bad.sql": "CREATE TABLE card (id TEXT); INSERT INTO missing VALUES (1);",
            },
        )
    )
    with pytest.raises(MigrationError, match=r"002_bad\.sql"):
        migrate(conn, migrations)
    assert user_version(conn) == 1
    assert "card" not in tables(conn)
    assert not conn.in_transaction


def test_migrate_rejects_newer_database(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA user_version = 5")
    with pytest.raises(MigrationError, match="newer"):
        migrate(conn, [])


PARENT_CHILD = (
    "CREATE TABLE work (id TEXT PRIMARY KEY, title TEXT);"
    "CREATE TABLE card (id TEXT PRIMARY KEY,"
    " work_id TEXT NOT NULL REFERENCES work(id) ON DELETE CASCADE);"
    "INSERT INTO work VALUES ('w_1', '첫 작품');"
    "INSERT INTO card VALUES ('c_1', 'w_1');"
)


def test_parent_table_rebuild_keeps_child_rows(tmp_path: Path, conn: sqlite3.Connection) -> None:
    rebuild = (
        "CREATE TABLE work_new (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '');"
        "INSERT INTO work_new SELECT id, title FROM work;"
        "DROP TABLE work;"
        "ALTER TABLE work_new RENAME TO work;"
    )
    migrations = discover(
        write(tmp_path / "m", {"001_init.sql": PARENT_CHILD, "002_rebuild.sql": rebuild})
    )
    migrate(conn, migrations)
    assert conn.execute("SELECT count(*) FROM card").fetchone()[0] == 1
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1


def test_migration_leaving_foreign_key_violation_is_rolled_back(
    tmp_path: Path, conn: sqlite3.Connection
) -> None:
    migrations = discover(
        write(
            tmp_path / "m",
            {"001_init.sql": PARENT_CHILD, "002_orphan.sql": "DELETE FROM work;"},
        )
    )
    with pytest.raises(MigrationError, match="foreign key violation in table card"):
        migrate(conn, migrations)
    assert user_version(conn) == 1
    assert conn.execute("SELECT count(*) FROM work").fetchone()[0] == 1
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1


def test_migration_ending_transaction_is_rejected(tmp_path: Path, conn: sqlite3.Connection) -> None:
    migrations = discover(
        write(tmp_path / "m", {"001_init.sql": "CREATE TABLE work (id TEXT); COMMIT;"})
    )
    with pytest.raises(MigrationError, match="must not end the transaction"):
        migrate(conn, migrations)
    assert not conn.in_transaction


def test_init_db_creates_parent_dirs(tmp_path: Path) -> None:
    path = tmp_path / "data" / "aiplot.db"
    init_db(path)
    assert path.is_file()
    check = connect(path)
    assert user_version(check) == len(discover())
    check.close()


def test_connect_pragmas(conn: sqlite3.Connection) -> None:
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == BUSY_TIMEOUT_MS
    assert conn.autocommit is True


def test_foreign_keys_enforced(conn: sqlite3.Connection) -> None:
    conn.execute("CREATE TABLE work (id TEXT PRIMARY KEY)")
    conn.execute("CREATE TABLE card (id TEXT, work_id TEXT REFERENCES work(id))")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO card VALUES ('c_1', 'w_missing')")


def test_transaction_commits_and_rolls_back(conn: sqlite3.Connection) -> None:
    conn.execute("CREATE TABLE t (v INTEGER)")
    with transaction(conn):
        conn.execute("INSERT INTO t VALUES (1)")
        conn.execute("INSERT INTO t VALUES (2)")
    with pytest.raises(RuntimeError), transaction(conn):
        conn.execute("INSERT INTO t VALUES (3)")
        raise RuntimeError("abort")
    assert [row["v"] for row in conn.execute("SELECT v FROM t ORDER BY v")] == [1, 2]
    assert not conn.in_transaction


def test_transaction_keeps_error_after_sqlite_rollback(conn: sqlite3.Connection) -> None:
    conn.execute("CREATE TABLE t (v INTEGER UNIQUE)")
    conn.execute("INSERT INTO t VALUES (1)")
    with pytest.raises(sqlite3.IntegrityError), transaction(conn):
        conn.execute("INSERT OR ROLLBACK INTO t VALUES (1)")
    assert not conn.in_transaction


def test_transaction_failed_commit_releases_lock(tmp_path: Path) -> None:
    path = tmp_path / "aiplot.db"
    conn = connect(path)
    conn.execute("CREATE TABLE work (id TEXT PRIMARY KEY)")
    conn.execute(
        "CREATE TABLE card (id TEXT,"
        " work_id TEXT REFERENCES work(id) DEFERRABLE INITIALLY DEFERRED)"
    )
    with pytest.raises(sqlite3.IntegrityError), transaction(conn):
        conn.execute("INSERT INTO card VALUES ('c_1', 'w_missing')")
    assert not conn.in_transaction
    other = connect(path)
    other.execute("PRAGMA busy_timeout = 0")
    with transaction(other):
        other.execute("INSERT INTO work VALUES ('w_1')")
    other.close()
    conn.close()


def test_fts5_available(conn: sqlite3.Connection) -> None:
    conn.execute("CREATE VIRTUAL TABLE names USING fts5(name, tokenize = 'trigram')")
    conn.execute("INSERT INTO names VALUES ('레오나르도')")
    rows = conn.execute("SELECT name FROM names WHERE names MATCH '레오나'").fetchall()
    assert [row["name"] for row in rows] == ["레오나르도"]


def test_get_db_gives_request_connection_to_app_db(tmp_path: Path) -> None:
    db_path = tmp_path / "aiplot.db"
    setup = connect(db_path)
    setup.execute("CREATE TABLE t (v TEXT)")
    setup.execute("INSERT INTO t VALUES ('저장됨')")
    setup.close()
    app = create_app(token=TOKEN, db_path=db_path)
    probe = APIRouter(prefix=f"{API_PREFIX}/probe")

    @probe.get("/value")
    def value(db: Db) -> str:
        row: sqlite3.Row = db.execute("SELECT v FROM t").fetchone()
        return str(row["v"])

    app.include_router(probe)
    response = TestClient(app).get("/api/v1/probe/value")
    assert response.json() == "저장됨"
