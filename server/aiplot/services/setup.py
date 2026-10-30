"""First-run setup (S0-1, §12): download llama.cpp + the base GGUF, or use files the user has.

Downloads resume from `.part` files with HTTP Range and are checked against the pinned size and
sha256 (config/llama.yaml, the base profile) before anything uses them. User-set paths are
checked the same way and kept in {data}/data/setup.json; files there are used in place.
"""

import asyncio
import hashlib
import json
import logging
import shutil
import subprocess
import time
import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx2 as httpx

from aiplot.generated.setup.status import SetupItem, SetupStatus
from aiplot.jobs.queue import JobContext, JobError
from aiplot.llm.config import LlamaBuild, Profile
from aiplot.llm.process import LlamaProcess

logger = logging.getLogger(__name__)

CHUNK = 1 << 20
ATTEMPTS = 3
PROGRESS_SEC = 0.5
# Room for extraction and for the OS on top of the download itself.
DISK_MARGIN = 1 << 30


@dataclass(frozen=True)
class Remote:
    url: str
    size: int
    sha256: str
    part: Path


@dataclass
class Progress:
    ctx: JobContext
    total: int
    done: int = 0
    step: str | None = None
    _last: float = 0.0

    def add(self, n: int) -> None:
        self.done += n
        now = time.monotonic()
        if now - self._last >= PROGRESS_SEC or self.done >= self.total:
            self._last = now
            self.ctx.progress(self.done, self.total, self.step)


def part_size(path: Path) -> int:
    return path.stat().st_size if path.is_file() else 0


def sha256_of(path: Path, on_chunk: Callable[[int], None] | None = None) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(CHUNK):
            digest.update(chunk)
            if on_chunk is not None:
                on_chunk(len(chunk))
    return digest.hexdigest()


class Setup:
    def __init__(
        self,
        data_dir: Path,
        build: LlamaBuild,
        profile: Profile,
        process: LlamaProcess | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.data_dir = data_dir
        self.build = build
        self.profile = profile
        self.process = process
        self._transport = transport
        self._overrides_file = data_dir / "data" / "setup.json"
        self.job_id: str | None = None
        self._apply_paths()

    # Locations -------------------------------------------------------------------------------

    def _overrides(self) -> dict[str, str]:
        try:
            raw = json.loads(self._overrides_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        return {
            k: v for k, v in raw.items() if k in ("model_path", "llama_dir") and isinstance(v, str)
        }

    def _save_overrides(self, overrides: dict[str, str]) -> None:
        self._overrides_file.parent.mkdir(parents=True, exist_ok=True)
        self._overrides_file.write_text(json.dumps(overrides, indent=1), encoding="utf-8")

    @property
    def default_llama_dir(self) -> Path:
        return self.data_dir / "llama" / self.build.dir

    @property
    def default_model(self) -> Path:
        return self.data_dir / "models" / self.profile.gguf.file

    @property
    def llama_dir(self) -> Path:
        custom = self._overrides().get("llama_dir")
        return Path(custom) if custom else self.default_llama_dir

    @property
    def model(self) -> Path:
        custom = self._overrides().get("model_path")
        return Path(custom) if custom else self.default_model

    @property
    def binary(self) -> Path:
        return self.llama_dir / self.build.executable

    def _forget_missing_overrides(self) -> None:
        """A download goes to the default place; drop a user path whose file is gone."""
        overrides = self._overrides()
        kept = {k: v for k, v in overrides.items() if Path(v).exists()}
        if kept != overrides:
            self._save_overrides(kept)

    def _apply_paths(self) -> None:
        if self.process is not None:
            self.process.binary = self.binary
            self.process.model = self.model
            self.process.files_changed()

    def _archive_parts(self) -> list[Remote]:
        staging = self.data_dir / "llama" / ".download"
        return [
            Remote(a.url, a.size, a.sha256, staging / f"{a.file}.part") for a in self.build.archives
        ]

    def _model_part(self) -> Remote:
        gguf = self.profile.gguf
        return Remote(
            gguf.source, gguf.size, gguf.sha256, self.default_model.with_name(f"{gguf.file}.part")
        )

    # Status ----------------------------------------------------------------------------------

    def llama_installed(self) -> bool:
        return self.binary.is_file()

    def model_installed(self) -> bool:
        # Size here; the sha256 was checked when the file was downloaded or its path set.
        return self.model.is_file() and self.model.stat().st_size == self.profile.gguf.size

    def status(self) -> SetupStatus:
        overrides = self._overrides()
        llama_total = sum(a.size for a in self.build.archives)
        llama_ok = self.llama_installed()
        llama_present = (
            llama_total if llama_ok else sum(part_size(r.part) for r in self._archive_parts())
        )
        model_ok = self.model_installed()
        model_present = self.profile.gguf.size if model_ok else part_size(self._model_part().part)
        items = [
            SetupItem(
                id="llama",
                status="installed" if llama_ok else ("partial" if llama_present else "missing"),
                path=str(self.llama_dir),
                custom="llama_dir" in overrides,
                total_bytes=llama_total,
                present_bytes=llama_present,
            ),
            SetupItem(
                id="model",
                status="installed" if model_ok else ("partial" if model_present else "missing"),
                path=str(self.model),
                custom="model_path" in overrides,
                total_bytes=self.profile.gguf.size,
                present_bytes=model_present,
            ),
        ]
        remaining = sum(i.total_bytes - i.present_bytes for i in items)
        free = shutil.disk_usage(
            self.data_dir if self.data_dir.exists() else self.data_dir.anchor
        ).free
        return SetupStatus(
            items=items, remaining_bytes=remaining, free_bytes=free, job_id=self.job_id
        )

    # Download job ----------------------------------------------------------------------------

    async def download(self, ctx: JobContext) -> dict[str, Any]:
        """Fetch whatever is not installed; resumable, verified, then starts llama-server."""
        self._forget_missing_overrides()
        need_llama = not self.llama_installed()
        need_model = not self.model_installed()
        remotes = (self._archive_parts() if need_llama else []) + (
            [self._model_part()] if need_model else []
        )
        total = sum(r.size for r in remotes)
        present = sum(min(part_size(r.part), r.size) for r in remotes)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        if shutil.disk_usage(self.data_dir).free < total - present + DISK_MARGIN:
            raise JobError("DISK_FULL", f"need {(total - present + DISK_MARGIN) >> 20} MB free")
        progress = Progress(ctx, total, done=present)
        progress.add(0)
        async with httpx.AsyncClient(
            transport=self._transport, follow_redirects=True, timeout=httpx.Timeout(30.0)
        ) as http:
            for remote in remotes:
                progress.step = remote.part.name.removesuffix(".part")
                await self._fetch(http, remote, progress, ctx)
        if need_llama:
            await asyncio.to_thread(self._extract_llama)
        if need_model:
            self._model_part().part.replace(self.default_model)
        self._apply_paths()
        installed = (["llama"] if need_llama else []) + (["model"] if need_model else [])
        return {"installed": installed}

    async def _fetch(
        self, http: httpx.AsyncClient, remote: Remote, progress: Progress, ctx: JobContext
    ) -> None:
        remote.part.parent.mkdir(parents=True, exist_ok=True)
        if part_size(remote.part) > remote.size:
            remote.part.unlink()
        for attempt in range(1, ATTEMPTS + 1):
            have = part_size(remote.part)
            if have == remote.size:
                break
            try:
                await self._fetch_from(http, remote, have, progress, ctx)
                break
            except httpx.TransportError as exc:
                # Bytes already written stay in the .part file and in progress.done.
                logger.warning("download %s attempt %d failed: %s", remote.url, attempt, exc)
                if attempt == ATTEMPTS:
                    raise JobError("DOWNLOAD_FAILED", f"{progress.step}: {exc}") from exc
                await asyncio.sleep(2.0 * attempt)
        # step names what runs; the app turns it into Korean text (§5).
        progress.step = f"verify {progress.step}"
        progress.ctx.progress(progress.done, progress.total, progress.step)
        digest = await asyncio.to_thread(sha256_of, remote.part)
        if digest != remote.sha256:
            remote.part.unlink()
            raise JobError("DOWNLOAD_CORRUPT", f"{remote.part.name}: sha256 mismatch, removed")

    async def _fetch_from(
        self,
        http: httpx.AsyncClient,
        remote: Remote,
        have: int,
        progress: Progress,
        ctx: JobContext,
    ) -> None:
        headers = {"Range": f"bytes={have}-"} if have else {}
        async with http.stream("GET", remote.url, headers=headers) as response:
            if have and response.status_code == 200:
                # The server ignored Range: start this file over.
                progress.done -= have
                have = 0
            elif response.status_code not in (200, 206):
                raise JobError("DOWNLOAD_FAILED", f"{remote.url}: HTTP {response.status_code}")
            with remote.part.open("ab" if have else "wb") as f:
                async for chunk in response.aiter_bytes(CHUNK):
                    f.write(chunk)
                    progress.add(len(chunk))
                    await ctx.checkpoint()
        if part_size(remote.part) != remote.size:
            raise httpx.ReadError(f"stream ended at {part_size(remote.part)} of {remote.size}")

    def _extract_llama(self) -> None:
        target = self.default_llama_dir
        staging = target.with_name(f".{target.name}.extract")
        shutil.rmtree(staging, ignore_errors=True)
        staging.mkdir(parents=True)
        for remote in self._archive_parts():
            with zipfile.ZipFile(remote.part) as archive:
                archive.extractall(staging)
        if not (staging / self.build.executable).is_file():
            shutil.rmtree(staging, ignore_errors=True)
            raise JobError("DOWNLOAD_CORRUPT", f"{self.build.executable} missing from the archive")
        shutil.rmtree(target, ignore_errors=True)
        staging.replace(target)
        for remote in self._archive_parts():
            remote.part.unlink(missing_ok=True)
        shutil.rmtree(self._archive_parts()[0].part.parent, ignore_errors=True)

    # Path check job --------------------------------------------------------------------------

    async def set_paths(
        self, ctx: JobContext, model_path: str | None, llama_dir: str | None
    ) -> dict[str, Any]:
        """None = default location. A path equal to the current one is kept unchecked."""
        overrides = self._overrides()
        if model_path is None:
            overrides.pop("model_path", None)
        elif str(Path(model_path).resolve()) != overrides.get("model_path"):
            await self._check_model(ctx, Path(model_path))
            overrides["model_path"] = str(Path(model_path).resolve())
        if llama_dir is None:
            overrides.pop("llama_dir", None)
        elif str(Path(llama_dir).resolve()) != overrides.get("llama_dir"):
            await asyncio.to_thread(self._check_llama, Path(llama_dir))
            overrides["llama_dir"] = str(Path(llama_dir).resolve())
        self._save_overrides(overrides)
        self._apply_paths()
        return {"model": str(self.model), "llama_dir": str(self.llama_dir)}

    async def _check_model(self, ctx: JobContext, path: Path) -> None:
        gguf = self.profile.gguf
        if not path.is_file():
            raise JobError("MODEL_NOT_FOUND", f"{path} is not a file")
        if path.stat().st_size != gguf.size:
            raise JobError("MODEL_MISMATCH", f"{path.name} is not {gguf.file} (size differs)")
        progress = Progress(ctx, gguf.size, step=f"verify {path.name}")
        loop = asyncio.get_running_loop()

        def on_chunk(n: int) -> None:
            loop.call_soon_threadsafe(progress.add, n)

        digest = await asyncio.to_thread(sha256_of, path, on_chunk)
        if digest != gguf.sha256:
            raise JobError("MODEL_MISMATCH", f"{path.name} is not {gguf.file} (sha256 differs)")

    def _check_llama(self, folder: Path) -> None:
        exe = folder / self.build.executable
        if not exe.is_file():
            raise JobError("LLAMA_NOT_FOUND", f"no {self.build.executable} in {folder}")
        try:
            out = subprocess.run(
                [str(exe), "--version"],
                capture_output=True,
                text=True,
                timeout=30,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise JobError("LLAMA_MISMATCH", f"{exe} does not run: {exc}") from exc
        if f"build {self.build.build.removeprefix('b')}" not in out.stdout + out.stderr:
            raise JobError("LLAMA_MISMATCH", f"{exe} is not llama.cpp {self.build.build}")
