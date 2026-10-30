"""The LLM side of a running server: the router services call, plus llama-server when real."""

import logging
from pathlib import Path

from aiplot.generated.common.health import LlamaHealth
from aiplot.llm.client import LlamaClient
from aiplot.llm.config import CONFIG_DIR, load_llama_build, load_llm_config
from aiplot.llm.fake import FakeClient
from aiplot.llm.process import LlamaProcess, free_port
from aiplot.llm.router import Router
from aiplot.llm.winjob import KillOnCloseJob
from aiplot.services.setup import Setup

LLAMA_LOGGER = "llama"


class LlmRuntime:
    def __init__(self, router: Router, setup: Setup, process: LlamaProcess | None = None) -> None:
        self.router = router
        self.setup = setup
        self.process = process

    def start(self) -> None:
        if self.process is not None:
            self.process.start()

    async def stop(self) -> None:
        if self.process is not None:
            await self.process.stop()

    def health(self) -> LlamaHealth:
        if self.process is None:
            return LlamaHealth(state="fake", profile=None, restarts=0, message=None)
        return self.process.health()


def fake_runtime(data_dir: Path, config_dir: Path = CONFIG_DIR) -> LlmRuntime:
    """AIPLOT_FAKE_LLM=1: fixture replies, no model, no GPU (tests, CI, GPU-less dev)."""
    config = load_llm_config(config_dir)
    setup = Setup(data_dir, load_llama_build(config_dir), config.base)
    return LlmRuntime(Router(config, FakeClient(), lora_dir=data_dir / "lora"), setup)


def llama_runtime(data_dir: Path, config_dir: Path = CONFIG_DIR) -> LlmRuntime:
    config = load_llm_config(config_dir)
    build = load_llama_build(config_dir)
    # Setup points the process at the default or user-set files right away.
    process = LlamaProcess(
        binary=data_dir / "llama" / build.dir / build.executable,
        model=data_dir / "models" / config.base.gguf.file,
        profile=config.base,
        port=free_port(),
        log=logging.getLogger(LLAMA_LOGGER),
        job=KillOnCloseJob(),
    )
    setup = Setup(data_dir, build, config.base, process)
    router = Router(config, LlamaClient(process.endpoint), lora_dir=data_dir / "lora")
    return LlmRuntime(router, setup, process)
