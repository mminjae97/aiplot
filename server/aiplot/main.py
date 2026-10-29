"""Aiplot local server entry point."""

import argparse
import os

import uvicorn
from fastapi import FastAPI

from aiplot.api import health

DEV_PORT = 8765
API_PREFIX = "/api/v1"


def create_app() -> FastAPI:
    app = FastAPI(title="Aiplot")
    app.include_router(health.router, prefix=API_PREFIX)
    return app


def resolve_port(value: str | None, *, dev: bool) -> int:
    """Return the port from AIPLOT_PORT; only dev runs may fall back to DEV_PORT."""
    if not value:
        if dev:
            return DEV_PORT
        raise ValueError("AIPLOT_PORT is required outside --dev")
    if not (value.isascii() and value.isdigit()):
        raise ValueError(f"not a decimal port: {value!r}")
    port = int(value)
    if not 1 <= port <= 65535:
        raise ValueError(f"port out of range: {port}")
    return port


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="aiplot")
    parser.add_argument("--dev", action="store_true", help="run with development defaults")
    args = parser.parse_args(argv)
    try:
        port = resolve_port(os.environ.get("AIPLOT_PORT"), dev=args.dev)
    except ValueError as exc:
        parser.error(f"invalid AIPLOT_PORT: {exc}")
    uvicorn.run(
        create_app(),
        host="127.0.0.1",
        port=port,
        log_level="debug" if args.dev else "info",
    )


if __name__ == "__main__":
    main()
