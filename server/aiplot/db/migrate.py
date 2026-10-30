"""Migrations: migrations/NNN_name.sql applied in order, version tracked by PRAGMA user_version.

NNN starts at 001 and is unique and contiguous. Each file runs in its own transaction together
with its user_version bump, so a file must not contain BEGIN/COMMIT itself. Foreign keys are off
while migrations run (a PRAGMA inside a transaction is a no-op, and a table rebuild must not
cascade deletes) and are checked before each commit.
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
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        for migration in migrations[current:]:
            apply(conn, migration)
            logger.info("applied migration %s", migration.path.name)
    finally:
        conn.execute("PRAGMA foreign_keys = ON")
    return latest


def apply(conn: sqlite3.Connection, migration: Migration) -> None:
    name = migration.path.name
    sql = migration.path.read_text(encoding="utf-8")
    conn.execute("BEGIN IMMEDIATE")
    try:
        # autocommit=True: executescript adds no transaction control of its own.
        conn.executescript(f"{sql}\n;PRAGMA user_version = {migration.version};")
        if not conn.in_transaction:
            raise MigrationError(f"{name}: must not end the transaction itself")
        violation = conn.execute("PRAGMA foreign_key_check").fetchone()
        if violation is not None:
            raise MigrationError(f"{name}: foreign key violation in table {violation[0]}")
        conn.execute("COMMIT")
    except (sqlite3.Error, MigrationError) as exc:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        if isinstance(exc, MigrationError):
            raise
        raise MigrationError(f"{name}: {exc}") from exc


def init_db(path: Path) -> None:
    """Create the database file if needed and bring it to the latest version."""
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = connect(path)
    try:
        version = migrate(conn, discover())
    finally:
        conn.close()
    logger.info("database %s at version %d", path, version)
