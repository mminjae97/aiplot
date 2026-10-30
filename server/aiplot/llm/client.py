"""Chat client contract and the llama-server client (OpenAI-compatible /v1/chat/completions)."""

import json
import os
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Protocol, TypedDict

import httpx2 as httpx

from aiplot.llm.config import Role, Sampling


class Message(TypedDict):
    role: Literal["system", "user", "assistant"]
    content: str


@dataclass(frozen=True)
class ChatRequest:
    role: Role
    messages: list[Message]
    thinking: bool
    thinking_kwarg: str
    sampling: Sampling
    max_tokens: int
    json_schema: dict[str, Any] | None = None
    lora: Path | None = None


@dataclass(frozen=True)
class Delta:
    kind: Literal["content", "reasoning"]
    text: str


class LlmError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class LlmClient(Protocol):
    def stream(self, request: ChatRequest) -> AsyncGenerator[Delta, None]: ...


def same_path(a: str | Path, b: str | Path) -> bool:
    return os.path.normcase(os.path.abspath(a)) == os.path.normcase(os.path.abspath(b))


class LlamaClient:
    """Streams deltas from llama-server; closing the iterator early stops generation there."""

    def __init__(self, base_url: str, *, transport: httpx.AsyncBaseTransport | None = None) -> None:
        # read: longest wait for the next bytes, including the first chunk, which arrives only
        # after queueing (-np 1) and prompt processing; the job queue (unit 6) serializes calls.
        timeout = httpx.Timeout(connect=5.0, read=120.0, write=30.0, pool=5.0)
        self._http = httpx.AsyncClient(base_url=base_url, transport=transport, timeout=timeout)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def stream(self, request: ChatRequest) -> AsyncGenerator[Delta, None]:
        try:
            body = await self._body(request)
            async with self._http.stream("POST", "/v1/chat/completions", json=body) as response:
                if response.status_code != 200:
                    detail = (await response.aread()).decode("utf-8", "replace")[:300]
                    raise status_error(response.status_code, detail)
                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line.removeprefix("data: ")
                    if data == "[DONE]":
                        return
                    for delta in parse_chunk(data):
                        yield delta
        except httpx.TransportError as exc:
            raise LlmError("LLM_UNAVAILABLE", f"llama-server unreachable: {exc}") from exc
        except httpx.RequestError as exc:
            raise LlmError("LLM_REQUEST_FAILED", f"bad response from llama-server: {exc}") from exc

    async def _body(self, request: ChatRequest) -> dict[str, Any]:
        sampling = request.sampling
        body: dict[str, Any] = {
            "messages": request.messages,
            "stream": True,
            "max_tokens": request.max_tokens,
            "temperature": sampling.temperature,
            "top_p": sampling.top_p,
            "top_k": sampling.top_k,
            "min_p": sampling.min_p,
            "chat_template_kwargs": {request.thinking_kwarg: request.thinking},
        }
        if request.json_schema is not None:
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": request.role, "schema": request.json_schema},
            }
        lora = await self._lora_scales(request.lora)
        if lora:
            body["lora"] = lora
        return body

    async def _lora_scales(self, wanted: Path | None) -> list[dict[str, Any]]:
        """Scale 1 for the wanted adapter and 0 for every other loaded one."""
        response = await self._http.get("/lora-adapters")
        if response.status_code != 200:
            raise status_error(response.status_code, "/lora-adapters")
        try:
            adapters: list[dict[str, Any]] = response.json()
            scales = [
                {"id": a["id"], "scale": 1.0 if wanted and same_path(a["path"], wanted) else 0.0}
                for a in adapters
            ]
        except (ValueError, KeyError, TypeError) as exc:
            raise LlmError("LLM_REQUEST_FAILED", f"bad /lora-adapters reply: {exc!r}") from exc
        if wanted is not None and not any(s["scale"] for s in scales):
            raise LlmError("LORA_NOT_LOADED", f"llama-server has not loaded {wanted.name}")
        return scales


def status_error(status: int, detail: str) -> LlmError:
    # 503 = llama-server is up but still loading the model: retry later, not a bad request.
    code = "LLM_UNAVAILABLE" if status == 503 else "LLM_REQUEST_FAILED"
    return LlmError(code, f"{status}: {detail}")


def parse_chunk(data: str) -> list[Delta]:
    try:
        chunk = json.loads(data)
        if "error" in chunk:
            raise LlmError("LLM_REQUEST_FAILED", str(chunk["error"]))
        deltas: list[Delta] = []
        for choice in chunk.get("choices", []):
            delta = choice.get("delta", {})
            if reasoning := delta.get("reasoning_content"):
                deltas.append(Delta("reasoning", reasoning))
            if content := delta.get("content"):
                deltas.append(Delta("content", content))
    except (ValueError, AttributeError, TypeError) as exc:
        raise LlmError("LLM_REQUEST_FAILED", f"bad stream chunk: {data[:200]!r}") from exc
    return deltas
