"""llama-server supervision against a stand-in process (no GPU, no real model)."""

import asyncio
import logging
import sys
from collections.abc import AsyncIterator, Callable
from pathlib import Path

import pytest

from aiplot.llm.config import load_llm_config
from aiplot.llm.process import MAX_RESTARTS, LlamaProcess, free_port
from aiplot.llm.winjob import KillOnCloseJob

pytestmark = pytest.mark.anyio

FAKE = Path(__file__).parent / "fake_llama_server.py"
JOB = KillOnCloseJob()


def make(tmp_path: Path, *, file_poll: float = 0.05) -> LlamaProcess:
    return LlamaProcess(
        binary=tmp_path / "llama" / "llama-server.exe",
        model=tmp_path / "models" / "base.gguf",
        profile=load_llm_config().base,
        port=free_port(),
        log=logging.getLogger("llama.test"),
        job=JOB,
        command=[sys.executable, str(FAKE)],
        load_timeout=10.0,
        check_interval=0.1,
        file_poll=file_poll,
        health_timeout=0.3,
    )


def install(tmp_path: Path, *, binary: bool = True, model: bool = True) -> None:
    if binary:
        (tmp_path / "llama").mkdir(exist_ok=True)
        (tmp_path / "llama" / "llama-server.exe").write_bytes(b"")
    if model:
        (tmp_path / "models").mkdir(exist_ok=True)
        (tmp_path / "models" / "base.gguf").write_bytes(b"GGUF")


async def until(
    process: LlamaProcess, check: Callable[[LlamaProcess], bool], timeout: float = 15.0
) -> None:
    async with asyncio.timeout(timeout):
        while not check(process):
            await asyncio.sleep(0.02)


@pytest.fixture
async def running(tmp_path: Path) -> AsyncIterator[LlamaProcess]:
    install(tmp_path)
    process = make(tmp_path)
    process.start()
    yield process
    await process.stop()


async def test_missing_files_wait_without_counting_restarts(tmp_path: Path) -> None:
    process = make(tmp_path, file_poll=60)
    process.start()
    await until(process, lambda p: p.state == "missing_binary")
    install(tmp_path, model=False)
    process.files_changed()
    await until(process, lambda p: p.state == "missing_model")
    assert process.message == "base.gguf not found"
    install(tmp_path)
    process.files_changed()
    await until(process, lambda p: p.state == "ready")
    assert process.restarts == 0
    await process.stop()


async def test_ready_with_profile_flags_inside_kill_on_close_job(running: LlamaProcess) -> None:
    await until(running, lambda p: p.state == "ready")
    argv = running.argv()
    assert argv[argv.index("-m") + 1] == str(running.model)
    assert argv[argv.index("-c") + 1] == "8192"
    assert argv[argv.index("--port") + 1] == str(running.port)
    assert argv[-len(running.profile.server_args) :] == list(running.profile.server_args)
    assert running.process is not None
    assert JOB.contains(running.process)
    health = running.health()
    assert (health.state, health.profile, health.restarts) == (
        "ready",
        "qwen3-8b-uncensor-q5km",
        0,
    )


async def test_stop_ends_the_process(running: LlamaProcess) -> None:
    await until(running, lambda p: p.state == "ready")
    child = running.process
    await running.stop()
    assert child is not None and child.poll() is not None
    assert running.state == "stopped"


async def test_crash_restarts_three_times_then_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FAKE_LLAMA_MODE", "crash")
    install(tmp_path)
    process = make(tmp_path)
    process.start()
    await until(process, lambda p: p.state == "error")
    assert process.restarts == MAX_RESTARTS
    assert process.message is not None
    assert "exit 1" in process.message and "out of memory" in process.message
    process.retry()
    await until(process, lambda p: p.restarts >= 1)
    await process.stop()


async def test_unresponsive_server_is_restarted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FAKE_LLAMA_MODE", "hang")
    install(tmp_path)
    process = make(tmp_path)
    process.start()
    await until(process, lambda p: p.restarts >= 1)
    await process.stop()


async def test_start_failure_is_reported(tmp_path: Path) -> None:
    install(tmp_path)
    process = make(tmp_path)
    process._command = [str(tmp_path / "no-such-program.exe")]
    process.start()
    await until(process, lambda p: p.state == "error")
    assert process.message is not None and process.message.startswith("could not start")
    await process.stop()
