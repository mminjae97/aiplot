"""Aiplot local server entry point."""

import argparse
import os

import uvicorn
from fastapi import FastAPI

DEFAULT_PORT = 8765


def create_app() -> FastAPI:
    app = FastAPI(title="Aiplot")

    @app.get("/api/v1/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


def resolve_port(value: str | None) -> int:
    """Return the port from AIPLOT_PORT, or the default when unset or empty."""
    if not value:
        return DEFAULT_PORT
    port = int(value)
    if not 1 <= port <= 65535:
        raise ValueError(f"port out of range: {port}")
    return port


def main() -> None:
    parser = argparse.ArgumentParser(prog="aiplot")
    parser.add_argument("--dev", action="store_true", help="run with development defaults")
    args = parser.parse_args()
    try:
        port = resolve_port(os.environ.get("AIPLOT_PORT"))
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
