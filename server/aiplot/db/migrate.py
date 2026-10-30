"""Migrations: migrations/NNN_name.sql applied in order, version tracked by PRAGMA user_version.

NNN starts at 001 and is unique and contiguous. Each file runs in its own transaction together
with its user_version bump, so a file must not contain BEGIN/COMMIT itself.
"""

import logging
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from aiplot.db.connection import connect

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).parent / "migrations"
MIGRATION_NAME = re.compile(r"(\d{3})_[a-z0-9_]+\.sql")


class MigrationError(Exception):
    pass


@dataclass(frozen=True)
class Migration:
    version: int
    path: Path


def discover(directory: Path = MIGRATIONS_DIR) -> list[Migration]:
    migrations: list[Migration] = []
    for path in sorted(directory.glob("*.sql")):
        match = MIGRATION_NAME.fullmatch(path.name)
        if match is None:
            raise MigrationError(f"bad migration file name: {path.name}")
        migrations.append(Migration(int(match[1]), path))
    versions = [m.version for m in migrations]
    if versions != list(range(1, len(migrations) + 1)):
        raise MigrationError(
            f"migration numbers must be unique and contiguous from 001: {versions}"
        )
    return migrations


def user_version(conn: sqlite3.Connection) -> int:
    version: int = conn.execute("PRAGMA user_version").fetchone()[0]
    return version


def migrate(conn: sqlite3.Connection, migrations: list[Migration]) -> int:
    """Apply pending migrations and return the resulting version."""
    current = user_version(conn)
    latest = len(migrations)
    if current > latest:
        raise MigrationError(f"database version {current} is newer than this app ({latest})")
    for migration in migrations[current:]:
        sql = migration.path.read_text(encoding="utf-8")
        try:
            conn.executescript(
                f"BEGIN IMMEDIATE;\n{sql}\n;PRAGMA user_version = {migration.version};\nCOMMIT;"
            )
        except sqlite3.Error as exc:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise MigrationError(f"{migration.path.name}: {exc}") from exc
        logger.info("applied migration %s", migration.path.name)
    return latest


def init_db(path: Path) -> None:
    """Create the database file if needed and bring it to the latest version."""
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = connect(path)
    try:
        version = migrate(conn, discover())
    finally:
        conn.close()
    logger.info("database %s at version %d", path, version)
