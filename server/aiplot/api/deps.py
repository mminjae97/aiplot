"""Shared router dependencies."""

import sqlite3
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request

from aiplot.db.connection import connect


def get_db(request: Request) -> Iterator[sqlite3.Connection]:
    """One connection per request, closed after the response."""
    conn = connect(request.app.state.db_path)
    try:
        yield conn
    finally:
        conn.close()


Db = Annotated[sqlite3.Connection, Depends(get_db)]
