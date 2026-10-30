"""llama-server lifecycle (§13): start when binary + model exist, health-check, restart ≤3.

Missing files are a state, not a failure: the first-run screen downloads them or the user sets
paths, then `files_changed()` starts the server without counting a restart. A crash or an
unresponsive server (several failed /health checks in a row) is restarted at most MAX_RESTARTS
times per session; after that the state is "error" until `retry()` (the "다시 시도" button).

Other local programs must not reach the model or the prompts it holds: llama-server gets a
fresh API key per start through LLAMA_API_KEY (not argv, which other processes can read), and a
port counts as ours only after our own child prints that it listens there. Every start picks a
fresh port, so a port taken in between only costs one restart. Callers get the address and key
from `endpoint()` per request, which answers only while that child is alive and confirmed.
"""

import asyncio
import contextlib
import logging
import os
import secrets
import socket
import subprocess
import threading
from collections import deque
from pathlib import Path
from typing import Literal

import httpx2 as httpx

from aiplot.generated.common.health import LlamaHealth
from aiplot.llm.config import Profile
from aiplot.llm.winjob import KillOnCloseJob

State = Literal["missing_binary", "missing_model", "starting", "ready", "error", "stopped"]
MAX_RESTARTS = 3
# 5.85 GB from a cold disk into VRAM.
LOAD_TIMEOUT_SEC = 300.0
CHECK_INTERVAL_SEC = 5.0
UNRESPONSIVE_CHECKS = 3
FILE_POLL_SEC = 5.0
STOP_TIMEOUT_SEC = 10.0
HEALTH_TIMEOUT_SEC = 5.0
TAIL_LINES = 20
# After the child exits its pipe reaches EOF; wait this long for the last lines.
PUMP_DRAIN_SEC = 1.0


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port: int = s.getsockname()[1]
        return port


class LlamaProcess:
    def __init__(
        self,
        *,
        binary: Path,
        model: Path,
        profile: Profile,
        port: int,
        log: logging.Logger,
        job: KillOnCloseJob | None,
        command: list[str] | None = None,
        load_timeout: float = LOAD_TIMEOUT_SEC,
        check_interval: float = CHECK_INTERVAL_SEC,
        file_poll: float = FILE_POLL_SEC,
        health_timeout: float = HEALTH_TIMEOUT_SEC,
    ) -> None:
        self.binary = binary
        self.model = model
        self.profile = profile
        self.port = port
        self.api_key = ""
        self.state: State = "stopped"
        self.restarts = 0
        self.message: str | None = None
        self._log = log
        self._job = job
        self._command = command or [str(binary)]
        self._load_timeout = load_timeout
        self._check_interval = check_interval
        self._file_poll = file_poll
        self._health_timeout = health_timeout
        self._process: subprocess.Popen[bytes] | None = None
        self._tail: deque[str] = deque(maxlen=TAIL_LINES)
        self._listening = threading.Event()
        self._pump_thread: threading.Thread | None = None
        self._spawned = False
        self._wake = asyncio.Event()
        self._stopping = False
        self._task: asyncio.Task[None] | None = None

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def argv(self) -> list[str]:
        p = self.profile
        return [
            *self._command,
            "-m",
            str(self.model),
            "-c",
            str(p.ctx),
            "-ctk",
            p.kv_type,
            "-ctv",
            p.kv_type,
            "--host",
            "127.0.0.1",
            "--port",
            str(self.port),
            *p.server_args,
        ]

    def endpoint(self) -> tuple[str, str] | None:
        """(url, api key) of the current child, or None unless it is ready, alive and confirmed
        on its port: a request must never reach whatever took a dead child's port."""
        if self.state != "ready" or not self._listening.is_set() or self._exited():
            return None
        return self.url, self.api_key

    def health(self) -> LlamaHealth:
        return LlamaHealth(
            state=self.state, profile=self.profile.id, restarts=self.restarts, message=self.message
        )

    def start(self) -> None:
        self._task = asyncio.create_task(self._supervise())

    async def stop(self) -> None:
        self._stopping = True
        self._wake.set()
        await self._kill()
        if self._task is not None:
            await self._task
        self.state = "stopped"

    def files_changed(self) -> None:
        """A download finished or a path was set: look again now."""
        self._wake.set()

    def retry(self) -> None:
        """After "error": start again with a fresh restart budget."""
        self.restarts = 0
        self._wake.set()

    @property
    def process(self) -> subprocess.Popen[bytes] | None:
        return self._process

    async def _supervise(self) -> None:
        while not self._stopping:
            missing = self._missing()
            if missing is not None:
                self.state, self.message = missing
                await self._sleep(self._file_poll)
                continue
            self.state, self.message = "starting", None
            failure = await self._run_once()
            await self._kill()
            if self._stopping:
                return
            if self.restarts >= MAX_RESTARTS:
                self.state, self.message = "error", failure
                self._log.error("llama-server gave up after %d restarts: %s", MAX_RESTARTS, failure)
                self._wake.clear()
                await self._wake.wait()
                continue
            self.restarts += 1
            self._log.warning(
                "restarting llama-server (%d/%d): %s", self.restarts, MAX_RESTARTS, failure
            )

    def _missing(self) -> tuple[State, str] | None:
        if not self.binary.is_file():
            return "missing_binary", f"{self.binary.name} not found"
        if not self.model.is_file():
            return "missing_model", f"{self.model.name} not found"
        return None

    async def _sleep(self, seconds: float) -> None:
        self._wake.clear()
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._wake.wait(), timeout=seconds)

    async def _run_once(self) -> str:
        """Start, wait for the model, then watch it. Returns why it stopped being usable."""
        try:
            self._spawn()
        except OSError as exc:
            return f"could not start {self.binary.name}: {exc}"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        async with httpx.AsyncClient(
            base_url=self.url, headers=headers, timeout=self._health_timeout
        ) as http:
            if not await self._wait_ready(http):
                return self._failure("did not become ready")
            self.state = "ready"
            self._log.info("llama-server ready on port %d (%s)", self.port, self.profile.id)
            return await self._watch(http)

    def _spawn(self) -> None:
        if self._spawned:
            self.port = free_port()
        self._spawned = True
        self.api_key = secrets.token_urlsafe(32)
        self._tail.clear()
        self._listening.clear()
        self._process = subprocess.Popen(
            self.argv(),
            env=os.environ | {"LLAMA_API_KEY": self.api_key},
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        if self._job is not None:
            self._job.assign(self._process)
        self._pump_thread = threading.Thread(target=self._pump, args=(self._process,), daemon=True)
        self._pump_thread.start()

    def _pump(self, process: subprocess.Popen[bytes]) -> None:
        assert process.stdout is not None
        for raw in process.stdout:
            line = raw.decode("utf-8", "replace").rstrip()
            if f"listening on {self.url}" in line:
                self._listening.set()
            self._tail.append(line)
            self._log.info(line)

    async def _wait_ready(self, http: httpx.AsyncClient) -> bool:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self._load_timeout
        while loop.time() < deadline and not self._stopping:
            if self._exited():
                return False
            # 503 while the model loads; 200 once it can serve. Until our child says it listens,
            # whatever answers on the port is not ours.
            if self._listening.is_set():
                with contextlib.suppress(httpx.HTTPError):
                    if (await http.get("/health")).status_code == 200:
                        return True
            await asyncio.sleep(0.25)
        return False

    async def _watch(self, http: httpx.AsyncClient) -> str:
        failed = 0
        while not self._stopping:
            await self._sleep(self._check_interval)
            if self._stopping:
                break
            if self._exited():
                return self._failure("exited")
            try:
                ok = (await http.get("/health")).status_code == 200
            except httpx.HTTPError:
                ok = False
            failed = 0 if ok else failed + 1
            if failed >= UNRESPONSIVE_CHECKS:
                return self._failure("stopped answering /health")
        return "stopped"

    def _exited(self) -> bool:
        return self._process is not None and self._process.poll() is not None

    def _failure(self, what: str) -> str:
        code = self._process.poll() if self._process is not None else None
        if code is not None and self._pump_thread is not None:
            # The cause (e.g. "out of memory") is often in the last lines still in the pipe.
            self._pump_thread.join(PUMP_DRAIN_SEC)
        detail = f" (exit {code})" if code is not None else ""
        # Copy first: the pump thread appends while we read (list() copies under the GIL).
        lines = list(self._tail)
        last = next((line for line in reversed(lines) if line.strip()), None)
        return f"llama-server {what}{detail}" + (f": {last}" if last else "")

    async def _kill(self) -> None:
        process = self._process
        if process is None or process.poll() is not None:
            return
        process.terminate()
        try:
            await asyncio.to_thread(process.wait, STOP_TIMEOUT_SEC)
        except subprocess.TimeoutExpired:
            process.kill()
            await asyncio.to_thread(process.wait)
