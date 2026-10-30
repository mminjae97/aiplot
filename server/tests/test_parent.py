"""The server ends with its parent (Electron)."""

import os
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

from aiplot.main import load_settings
from aiplot.parent import parse_pid, wait_for_exit, watch

SERVER_DIR = Path(__file__).resolve().parents[1]


def sleeper(seconds: float) -> subprocess.Popen[bytes]:
    return subprocess.Popen([sys.executable, "-c", f"import time; time.sleep({seconds})"])


@pytest.mark.parametrize(("value", "pid"), [(None, None), ("", None), ("1234", 1234)])
def test_parse_pid(value: str | None, pid: int | None) -> None:
    assert parse_pid(value) == pid


@pytest.mark.parametrize("value", ["abc", "0", "-5", " 12", "١٢"])
def test_parse_pid_rejects(value: str) -> None:
    with pytest.raises(ValueError):
        parse_pid(value)


def test_settings_read_parent_pid(tmp_path: Path) -> None:
    env = {"AIPLOT_PORT": "9001", "AIPLOT_TOKEN": "t", "AIPLOT_DATA_DIR": str(tmp_path)}
    assert load_settings(env, dev=False).parent_pid is None
    assert load_settings(env | {"AIPLOT_PARENT_PID": "77"}, dev=False).parent_pid == 77
    with pytest.raises(ValueError, match="AIPLOT_PARENT_PID"):
        load_settings(env | {"AIPLOT_PARENT_PID": "x"}, dev=False)


def test_wait_returns_when_the_process_ends() -> None:
    child = sleeper(0.3)
    started = time.monotonic()
    wait_for_exit(child.pid)
    assert child.wait(5) == 0
    assert time.monotonic() - started < 5


def test_wait_returns_at_once_for_a_gone_process() -> None:
    child = sleeper(0)
    child.wait(5)
    started = time.monotonic()
    wait_for_exit(child.pid)
    assert time.monotonic() - started < 1


def test_watch_calls_back_from_a_daemon_thread() -> None:
    child = sleeper(0.2)
    called = threading.Event()
    thread = watch(child.pid, called.set)
    assert thread.daemon
    assert called.wait(5)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port: int = s.getsockname()[1]
        return port


def test_server_shuts_down_when_its_parent_dies(tmp_path: Path) -> None:
    parent = sleeper(1.5)
    env = os.environ | {
        "AIPLOT_TOKEN": "t",
        "AIPLOT_PORT": str(free_port()),
        "AIPLOT_DATA_DIR": str(tmp_path),
        "AIPLOT_FAKE_LLM": "1",
        "AIPLOT_PARENT_PID": str(parent.pid),
    }
    server = subprocess.Popen(
        [sys.executable, "-m", "aiplot.main"],
        cwd=SERVER_DIR,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        assert server.wait(30) == 0
    finally:
        if server.poll() is None:
            server.kill()
    log = (tmp_path / "logs" / "server.log").read_text(encoding="utf-8")
    assert f"parent process {parent.pid} ended" in log
