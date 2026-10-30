"""Exit with the app (§13): Electron passes its PID, and the server shuts down when it is gone.

Node has no Job Object API, so the server watches its parent instead. Shutdown is graceful (jobs
stop, llama-server stops), and llama-server's own Job Object covers the case where the server
itself is killed.
"""

import ctypes
import logging
import threading
from collections.abc import Callable
from ctypes import wintypes

logger = logging.getLogger(__name__)

SYNCHRONIZE = 0x00100000
INFINITE = 0xFFFFFFFF


def parse_pid(value: str | None) -> int | None:
    """AIPLOT_PARENT_PID; None when unset (dev runs without Electron)."""
    if not value:
        return None
    if not (value.isascii() and value.isdigit()) or int(value) <= 0:
        raise ValueError(f"not a process id: {value!r}")
    return int(value)


def wait_for_exit(pid: int) -> None:
    """Block until the process ends; return at once if it is already gone."""
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.WaitForSingleObject.restype = wintypes.DWORD
    kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel32.OpenProcess(SYNCHRONIZE, False, pid)
    if not handle:
        return
    try:
        kernel32.WaitForSingleObject(handle, INFINITE)
    finally:
        kernel32.CloseHandle(handle)


def watch(pid: int, on_exit: Callable[[], None]) -> threading.Thread:
    """Call on_exit (from the watcher thread) once the parent process ends."""

    def run() -> None:
        wait_for_exit(pid)
        logger.warning("parent process %d ended; shutting down", pid)
        on_exit()

    # Daemon: never keeps the server alive, and never blocks interpreter exit.
    thread = threading.Thread(target=run, name="parent-watch", daemon=True)
    thread.start()
    return thread
