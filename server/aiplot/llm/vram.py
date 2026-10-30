"""GPU memory from nvidia-smi for /health and logs (§16, §17)."""

import asyncio
import subprocess
import time

from aiplot.generated.common.health import VramUsage

CACHE_SEC = 5.0
_cache: tuple[float, VramUsage | None] | None = None


def query() -> VramUsage | None:
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=3,
            check=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        ).stdout
        used, total = (int(v) for v in out.splitlines()[0].split(","))
    except (OSError, subprocess.SubprocessError, ValueError, IndexError):
        return None
    return VramUsage(used_mb=used, total_mb=total)


async def read() -> VramUsage | None:
    """Cached for a few seconds: health is polled often and nvidia-smi takes ~0.1 s."""
    global _cache
    now = time.monotonic()
    if _cache is None or now - _cache[0] > CACHE_SEC:
        _cache = (now, await asyncio.to_thread(query))
    return _cache[1]
