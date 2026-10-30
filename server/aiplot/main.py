"""Aiplot local server entry point."""

import argparse
import logging
import os
import socket
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path

import uvicorn
from fastapi import APIRouter, Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from aiplot.api import health, jobs, setup, works
from aiplot.api.auth import require_token
from aiplot.api.errors import install_error_handlers
from aiplot.db.migrate import MigrationError, init_db
from aiplot.jobs.queue import JobQueue
from aiplot.llm.runtime import LLAMA_LOGGER, LlmRuntime, fake_runtime, llama_runtime
from aiplot.parent import parse_pid, watch

DEV_PORT = 8765
API_PREFIX = "/api/v1"
LOG_RETENTION_DAYS = 14
# Read by app/electron/processes.ts; followed by the bound port.
READY_LINE = "AIPLOT_READY"

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Settings:
    port: int
    token: str
    data_dir: Path
    fake_llm: bool = False
    parent_pid: int | None = None
    dev_origin: str | None = None

    @property
    def db_path(self) -> Path:
        return self.data_dir / "data" / "aiplot.db"


def create_app(
    *,
    token: str,
    db_path: Path,
    dev: bool = False,
    llm: LlmRuntime | None = None,
    dev_origin: str | None = None,
) -> FastAPI:
    """llm defaults to the fixture runtime so tests never need a GPU. dev_origin is the Vite dev
    server the renderer runs on in `npm run dev`; only --dev runs allow it (CORS)."""
    job_queue = JobQueue()
    runtime = llm or fake_runtime(db_path.parent)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        # llama-server loads in the background: the API is up before the model is (§13).
        runtime.start()
        job_queue.start()
        yield
        await job_queue.stop()
        await runtime.stop()

    # Interactive API docs are a development aid only.
    app = FastAPI(
        title="Aiplot",
        lifespan=lifespan,
        docs_url="/docs" if dev else None,
        redoc_url="/redoc" if dev else None,
        openapi_url="/openapi.json" if dev else None,
    )
    app.state.token = token
    app.state.db_path = db_path
    app.state.jobs = job_queue
    app.state.llm = runtime
    install_error_handlers(app)
    if dev and dev_origin:
        # Outside the router, so preflight OPTIONS never needs the token.
        app.add_middleware(
            CORSMiddleware,
            allow_origins=[dev_origin],
            allow_methods=["*"],
            allow_headers=["Authorization", "Content-Type", "Last-Event-ID"],
        )
    api = APIRouter(prefix=API_PREFIX, dependencies=[Depends(require_token)])
    api.include_router(health.router)
    api.include_router(jobs.router)
    api.include_router(setup.router)
    api.include_router(works.router)
    app.include_router(api)
    return app


class ReportingServer(uvicorn.Server):
    """Prints READY_LINE on stdout once the socket is bound. Electron trusts the port only after
    its own child says so, never a process that happens to answer there (§13)."""

    async def startup(self, sockets: list[socket.socket] | None = None) -> None:
        await super().startup(sockets)
        if self.started:
            print(f"{READY_LINE} {self.config.port}", flush=True)


def env_value(env: Mapping[str, str], name: str) -> str | None:
    value = env.get(name)
    return value or None


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


def resolve_token(value: str | None) -> str:
    """Return AIPLOT_TOKEN; required in every run, printable ASCII without spaces."""
    if not value:
        raise ValueError("AIPLOT_TOKEN is required")
    if not all("!" <= ch <= "~" for ch in value):
        raise ValueError("token must be printable ASCII without spaces")
    return value


def resolve_data_dir(env: Mapping[str, str]) -> Path:
    """Same rule as app/electron/main.ts: AIPLOT_DATA_DIR, else %LOCALAPPDATA%\\Aiplot."""
    override = env_value(env, "AIPLOT_DATA_DIR")
    if override:
        return Path(override).resolve()
    local_app_data = env_value(env, "LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    return (Path(local_app_data) / "Aiplot").resolve()


def load_settings(env: Mapping[str, str], *, dev: bool) -> Settings:
    try:
        port = resolve_port(env_value(env, "AIPLOT_PORT"), dev=dev)
    except ValueError as exc:
        raise ValueError(f"invalid AIPLOT_PORT: {exc}") from exc
    try:
        token = resolve_token(env_value(env, "AIPLOT_TOKEN"))
    except ValueError as exc:
        raise ValueError(f"invalid AIPLOT_TOKEN: {exc}") from exc
    try:
        parent_pid = parse_pid(env_value(env, "AIPLOT_PARENT_PID"))
    except ValueError as exc:
        raise ValueError(f"invalid AIPLOT_PARENT_PID: {exc}") from exc
    fake_llm = env_value(env, "AIPLOT_FAKE_LLM") == "1"
    return Settings(
        port=port,
        token=token,
        data_dir=resolve_data_dir(env),
        fake_llm=fake_llm,
        parent_pid=parent_pid,
        dev_origin=env_value(env, "AIPLOT_DEV_ORIGIN"),
    )


def setup_logging(log_dir: Path, *, dev: bool) -> None:
    """Daily-rotated logs per process under the data dir (§17): server.log, and llama.log for
    llama-server's own output; console too in dev."""
    log_dir.mkdir(parents=True, exist_ok=True)
    llama_handler = TimedRotatingFileHandler(
        log_dir / "llama.log", when="midnight", backupCount=LOG_RETENTION_DAYS, encoding="utf-8"
    )
    llama_handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
    llama = logging.getLogger(LLAMA_LOGGER)
    for old in llama.handlers[:]:
        llama.removeHandler(old)
        old.close()
    llama.addHandler(llama_handler)
    llama.propagate = False
    file_handler = TimedRotatingFileHandler(
        log_dir / "server.log",
        when="midnight",
        backupCount=LOG_RETENTION_DAYS,
        encoding="utf-8",
    )
    handlers: list[logging.Handler] = [file_handler]
    if dev:
        handlers.append(logging.StreamHandler())
    logging.basicConfig(
        level=logging.DEBUG if dev else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=handlers,
        force=True,
    )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="aiplot")
    parser.add_argument("--dev", action="store_true", help="run with development defaults")
    args = parser.parse_args(argv)
    try:
        settings = load_settings(os.environ, dev=args.dev)
    except ValueError as exc:
        parser.error(str(exc))
    setup_logging(settings.data_dir / "logs", dev=args.dev)
    try:
        init_db(settings.db_path)
    except MigrationError:
        logger.exception("database migration failed")
        raise SystemExit(1) from None
    data_dir = settings.data_dir
    llm = fake_runtime(data_dir) if settings.fake_llm else llama_runtime(data_dir)
    server = ReportingServer(
        uvicorn.Config(
            create_app(
                token=settings.token,
                db_path=settings.db_path,
                dev=args.dev,
                llm=llm,
                dev_origin=settings.dev_origin,
            ),
            host="127.0.0.1",
            port=settings.port,
            log_level="debug" if args.dev else "info",
            # Uvicorn loggers propagate to the root handlers set up above.
            log_config=None,
        )
    )
    if settings.parent_pid is not None:

        def stop() -> None:
            # Read by uvicorn's main loop: a normal graceful shutdown.
            server.should_exit = True

        watch(settings.parent_pid, stop)
    server.run()


if __name__ == "__main__":
    main()
