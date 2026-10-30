"""First-run setup against a local file server: download, resume, verify, user paths."""

import asyncio
import hashlib
import io
import os
import subprocess
import threading
import zipfile
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from aiplot.jobs.queue import JobQueue, JobRecord
from aiplot.llm.config import (
    Gguf,
    LlamaArchive,
    LlamaBuild,
    Profile,
    load_llama_build,
    load_llm_config,
)
from aiplot.services.setup import Setup

pytestmark = pytest.mark.anyio

MODEL = os.urandom(3 * (1 << 20) + 123)


def zipped(name: str, data: bytes) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(name, data)
    return buffer.getvalue()


SERVER_ZIP = zipped("llama-server.exe", b"MZ fake server")
CUDART_ZIP = zipped("cudart64_13.dll", b"MZ fake dll")


@dataclass
class Files:
    """What the local server serves, and how it misbehaves."""

    content: dict[str, bytes]
    ignore_range: bool = False
    drop_once: set[str] = field(default_factory=set)
    corrupt: set[str] = field(default_factory=set)
    ranges: list[tuple[str, str | None]] = field(default_factory=list)


@pytest.fixture
def files() -> Iterator[tuple[Files, str]]:
    state = Files({"/model.gguf": MODEL, "/server.zip": SERVER_ZIP, "/cudart.zip": CUDART_ZIP})

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            data = state.content.get(self.path)
            if data is None:
                self.send_error(404)
                return
            if self.path in state.corrupt:
                data = bytes(len(data))
            header = self.headers.get("Range")
            state.ranges.append((self.path, header))
            start = 0
            if header and not state.ignore_range:
                start = int(header.removeprefix("bytes=").split("-")[0])
                self.send_response(206)
                self.send_header("Content-Range", f"bytes {start}-{len(data) - 1}/{len(data)}")
            else:
                self.send_response(200)
            body = data[start:]
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.path in state.drop_once:
                state.drop_once.discard(self.path)
                self.wfile.write(body[: len(body) // 2])
                self.wfile.flush()
                self.connection.close()
                return
            self.wfile.write(body)

        def log_message(self, format: str, *args: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield state, f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


def pins(base_url: str) -> tuple[LlamaBuild, Profile]:
    def archive(name: str, data: bytes) -> LlamaArchive:
        sha = hashlib.sha256(data).hexdigest()
        return LlamaArchive.model_construct(
            file=f"{name}.zip", url=f"{base_url}/{name}.zip", size=len(data), sha256=sha
        )

    build = load_llama_build().model_copy(
        update={
            "dir": "b1-test",
            "archives": (archive("server", SERVER_ZIP), archive("cudart", CUDART_ZIP)),
        }
    )
    gguf = Gguf.model_construct(
        file="base.gguf",
        size=len(MODEL),
        sha256=hashlib.sha256(MODEL).hexdigest(),
        source=f"{base_url}/model.gguf",
    )
    return build, load_llm_config().base.model_copy(update={"gguf": gguf})


@pytest.fixture
async def jobs() -> AsyncIterator[JobQueue]:
    q = JobQueue()
    q.start()
    yield q
    await q.stop()


@pytest.fixture
def installer(tmp_path: Path, files: tuple[Files, str]) -> Setup:
    build, profile = pins(files[1])
    return Setup(tmp_path, build, profile)


async def finish(job: JobRecord, timeout: float = 20.0) -> JobRecord:
    async with asyncio.timeout(timeout):
        while job.status not in ("done", "failed", "cancelled"):
            await asyncio.sleep(0.01)
    return job


def error_code(job: JobRecord) -> str | None:
    return job.error.code if job.error else None


def download(jobs: JobQueue, installer: Setup) -> JobRecord:
    return jobs.submit("download", installer.download, lane="download")


def set_paths(jobs: JobQueue, installer: Setup, model: str | None, llama: str | None) -> JobRecord:
    return jobs.submit("verify_paths", lambda ctx: installer.set_paths(ctx, model, llama))


async def test_status_before_anything(installer: Setup) -> None:
    status = installer.status()
    assert [(i.id, i.status, i.present_bytes) for i in status.items] == [
        ("llama", "missing", 0),
        ("model", "missing", 0),
    ]
    assert status.remaining_bytes == len(SERVER_ZIP) + len(CUDART_ZIP) + len(MODEL)
    assert status.free_bytes > 0


async def test_download_installs_and_reports_progress(installer: Setup, jobs: JobQueue) -> None:
    job = await finish(download(jobs, installer))
    assert job.status == "done", job.error
    assert job.events[-1].data == {"result": {"installed": ["llama", "model"]}}
    assert (installer.default_llama_dir / "llama-server.exe").read_bytes() == b"MZ fake server"
    assert (installer.default_llama_dir / "cudart64_13.dll").is_file()
    assert installer.default_model.read_bytes() == MODEL
    assert not (installer.data_dir / "llama" / ".download").exists()
    done = [e.data["done"] for e in job.events if e.type == "progress"]
    assert done == sorted(done)
    assert done[-1] == installer.status().items[0].total_bytes + len(MODEL)
    assert {i.status for i in installer.status().items} == {"installed"}


async def test_download_resumes_a_partial_file(
    installer: Setup, jobs: JobQueue, files: tuple[Files, str]
) -> None:
    part = installer.default_model.with_name("base.gguf.part")
    part.parent.mkdir(parents=True)
    part.write_bytes(MODEL[:1000])
    assert installer.status().items[1].status == "partial"
    job = await finish(download(jobs, installer))
    assert job.status == "done", job.error
    assert ("/model.gguf", "bytes=1000-") in files[0].ranges
    assert installer.default_model.read_bytes() == MODEL


async def test_server_ignoring_range_restarts_the_file(
    installer: Setup, jobs: JobQueue, files: tuple[Files, str]
) -> None:
    files[0].ignore_range = True
    part = installer.default_model.with_name("base.gguf.part")
    part.parent.mkdir(parents=True)
    part.write_bytes(MODEL[:1000])
    job = await finish(download(jobs, installer))
    assert job.status == "done", job.error
    assert installer.default_model.read_bytes() == MODEL


real_sleep = asyncio.sleep


async def fast_sleep(delay: float, result: Any = None) -> Any:
    return await real_sleep(min(delay, 0.01), result)


async def test_dropped_connection_is_resumed(
    installer: Setup, jobs: JobQueue, files: tuple[Files, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(asyncio, "sleep", fast_sleep)
    files[0].drop_once.add("/model.gguf")
    job = await finish(download(jobs, installer))
    assert job.status == "done", job.error
    model_requests = [r for r in files[0].ranges if r[0] == "/model.gguf"]
    assert len(model_requests) == 2 and model_requests[1][1] is not None
    assert installer.default_model.read_bytes() == MODEL


async def test_corrupt_download_is_removed(
    installer: Setup, jobs: JobQueue, files: tuple[Files, str]
) -> None:
    files[0].corrupt.add("/model.gguf")
    job = await finish(download(jobs, installer))
    assert error_code(job) == "DOWNLOAD_CORRUPT"
    assert not installer.default_model.with_name("base.gguf.part").exists()
    assert not installer.default_model.exists()


async def test_not_enough_disk(
    installer: Setup, jobs: JobQueue, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "aiplot.services.setup.shutil.disk_usage", lambda _: SimpleNamespace(free=10)
    )
    job = await finish(download(jobs, installer))
    assert error_code(job) == "DISK_FULL"


async def test_user_model_path_is_checked_and_kept(
    installer: Setup, jobs: JobQueue, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    mine = tmp_path / "elsewhere" / "base.gguf"
    mine.parent.mkdir()
    mine.write_bytes(MODEL)
    job = await finish(set_paths(jobs, installer, str(mine), None))
    assert job.status == "done", job.error
    item = installer.status().items[1]
    assert (item.status, item.custom, item.path) == ("installed", True, str(mine.resolve()))

    def no_rehash(*args: object) -> str:
        raise AssertionError("an unchanged path must not be hashed again")

    monkeypatch.setattr("aiplot.services.setup.sha256_of", no_rehash)
    assert (await finish(set_paths(jobs, installer, str(mine), None))).status == "done"
    assert (await finish(set_paths(jobs, installer, None, None))).status == "done"
    assert installer.status().items[1].custom is False


async def test_wrong_user_model_is_refused(
    installer: Setup, jobs: JobQueue, tmp_path: Path
) -> None:
    other = tmp_path / "other.gguf"
    other.write_bytes(MODEL[:-1] + b"x")
    job = await finish(set_paths(jobs, installer, str(other), None))
    assert error_code(job) == "MODEL_MISMATCH"
    short = tmp_path / "short.gguf"
    short.write_bytes(b"GGUF")
    job = await finish(set_paths(jobs, installer, str(short), None))
    assert error_code(job) == "MODEL_MISMATCH"
    job = await finish(set_paths(jobs, installer, str(tmp_path / "none.gguf"), None))
    assert error_code(job) == "MODEL_NOT_FOUND"
    assert installer.status().items[1].custom is False


async def test_user_llama_dir_needs_the_pinned_build(
    installer: Setup, jobs: JobQueue, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    folder = tmp_path / "my-llama"
    folder.mkdir()
    job = await finish(set_paths(jobs, installer, None, str(folder)))
    assert error_code(job) == "LLAMA_NOT_FOUND"
    (folder / "llama-server.exe").write_bytes(b"MZ")
    version = ["version: 0.8.0-dev (build 11000, commit abc)"]

    def fake_run(*args: object, **kwargs: object) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess([], 0, stdout="", stderr=version[0])

    monkeypatch.setattr("aiplot.services.setup.subprocess.run", fake_run)
    job = await finish(set_paths(jobs, installer, None, str(folder)))
    assert error_code(job) == "LLAMA_MISMATCH"
    version[0] = "version: 0.8.0-dev (build 11982, commit 8a199ad31)"
    job = await finish(set_paths(jobs, installer, None, str(folder)))
    assert job.status == "done", job.error
    assert installer.status().items[0].custom and installer.llama_installed()


async def test_download_drops_a_user_path_whose_file_is_gone(
    installer: Setup, jobs: JobQueue, tmp_path: Path
) -> None:
    mine = tmp_path / "elsewhere.gguf"
    mine.write_bytes(MODEL)
    await finish(set_paths(jobs, installer, str(mine), None))
    mine.unlink()
    job = await finish(download(jobs, installer))
    assert job.status == "done", job.error
    item = installer.status().items[1]
    assert (item.status, item.custom) == ("installed", False)
