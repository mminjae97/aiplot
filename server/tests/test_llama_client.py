import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx2 as httpx
import pytest

from aiplot.llm.client import ChatRequest, Delta, LlamaClient, LlmError, Usage, parse_chunk
from aiplot.llm.config import Sampling

pytestmark = pytest.mark.anyio

SAMPLING = Sampling(temperature=0.3, top_p=0.95, top_k=20, min_p=0.0)


def chat_request(**changes: Any) -> ChatRequest:
    fields: dict[str, Any] = {
        "role": "card",
        "messages": [{"role": "system", "content": "시스템"}, {"role": "user", "content": "원문"}],
        "thinking": True,
        "thinking_kwarg": "enable_thinking",
        "sampling": SAMPLING,
        "max_tokens": 100,
    }
    fields.update(changes)
    return ChatRequest(**fields)


def sse(*chunks: dict[str, Any], done: bool = True) -> bytes:
    lines = [f"data: {json.dumps(c, ensure_ascii=False)}\n\n" for c in chunks]
    if done:
        lines.append("data: [DONE]\n\n")
    return "".join(lines).encode()


def delta(**fields: str) -> dict[str, Any]:
    return {"choices": [{"index": 0, "delta": fields}]}


class Llama:
    """In-memory llama-server: records request bodies, answers with canned SSE."""

    def __init__(self, body: bytes, *, adapters: list[dict[str, Any]] | None = None) -> None:
        self.body = body
        self.adapters = adapters or []
        self.sent: list[dict[str, Any]] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == "/lora-adapters":
            return httpx.Response(200, json=self.adapters)
        self.sent.append(json.loads(request.content))
        return httpx.Response(200, content=self.body)

    def client(self) -> LlamaClient:
        return LlamaClient("http://llama", transport=httpx.MockTransport(self.handler))


async def collect(client: LlamaClient, request: ChatRequest) -> list[Delta]:
    try:
        return [d async for d in client.stream(request)]
    finally:
        await client.aclose()


async def test_streams_reasoning_and_content() -> None:
    llama = Llama(
        sse(
            delta(role="assistant"),
            delta(reasoning_content="생각"),
            delta(content='{"a":'),
            delta(content="1}"),
            {"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}], "timings": {}},
        )
    )
    deltas = await collect(llama.client(), chat_request())
    assert deltas == [
        Delta("reasoning", "생각"),
        Delta("content", '{"a":'),
        Delta("content", "1}"),
        Delta("finish", "stop"),
    ]


def test_finish_carries_usage() -> None:
    timings = {"prompt_n": 15, "cache_n": 641, "predicted_n": 30, "predicted_ms": 500.0}
    chunk = {"choices": [{"index": 0, "delta": {}, "finish_reason": "length"}], "timings": timings}
    assert parse_chunk(json.dumps(chunk)) == [Delta("finish", "length", Usage(656, 641, 30))]


async def test_request_body() -> None:
    llama = Llama(sse())
    schema = {"type": "object"}
    await collect(llama.client(), chat_request(json_schema=schema))
    [body] = llama.sent
    assert body["messages"][1] == {"role": "user", "content": "원문"}
    assert body["stream"] is True
    assert body["chat_template_kwargs"] == {"enable_thinking": True}
    assert (body["temperature"], body["top_p"], body["top_k"], body["min_p"]) == (0.3, 0.95, 20, 0)
    assert body["max_tokens"] == 100
    assert body["response_format"] == {
        "type": "json_schema",
        "json_schema": {"name": "card", "schema": schema},
    }
    assert "lora" not in body


async def test_no_response_format_for_text_roles() -> None:
    llama = Llama(sse())
    await collect(llama.client(), chat_request(role="chat", thinking=False))
    [body] = llama.sent
    assert "response_format" not in body
    assert body["chat_template_kwargs"] == {"enable_thinking": False}


async def test_lora_scales_select_wanted_adapter(tmp_path: Path) -> None:
    wanted = tmp_path / "direction-v1.gguf"
    adapters = [
        {"id": 0, "path": str(tmp_path / "webnovel-v1.gguf"), "scale": 0.0},
        # llama-server reports the path it was given; compare case-insensitively on Windows.
        {"id": 1, "path": str(wanted).upper(), "scale": 0.0},
    ]
    llama = Llama(sse(), adapters=adapters)
    await collect(llama.client(), chat_request(lora=wanted))
    assert llama.sent[0]["lora"] == [{"id": 0, "scale": 0.0}, {"id": 1, "scale": 1.0}]


async def test_loaded_adapters_are_off_without_lora(tmp_path: Path) -> None:
    llama = Llama(sse(), adapters=[{"id": 0, "path": str(tmp_path / "a.gguf"), "scale": 1.0}])
    await collect(llama.client(), chat_request())
    assert llama.sent[0]["lora"] == [{"id": 0, "scale": 0.0}]


async def test_wanted_adapter_not_loaded(tmp_path: Path) -> None:
    llama = Llama(sse())
    with pytest.raises(LlmError) as exc_info:
        await collect(llama.client(), chat_request(lora=tmp_path / "direction-v1.gguf"))
    assert exc_info.value.code == "LORA_NOT_LOADED"
    assert llama.sent == []


def failing(make: Callable[[httpx.Request], httpx.Response]) -> LlamaClient:
    return LlamaClient("http://llama", transport=httpx.MockTransport(make))


async def test_http_error_status() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/lora-adapters":
            return httpx.Response(200, json=[])
        return httpx.Response(400, json={"error": {"message": "bad schema"}})

    with pytest.raises(LlmError) as exc_info:
        await collect(failing(handler), chat_request())
    assert exc_info.value.code == "LLM_REQUEST_FAILED"
    assert "bad schema" in str(exc_info.value)


async def test_server_unreachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    with pytest.raises(LlmError) as exc_info:
        await collect(failing(handler), chat_request())
    assert exc_info.value.code == "LLM_UNAVAILABLE"


@pytest.mark.parametrize(
    ("status", "code"), [(503, "LLM_UNAVAILABLE"), (500, "LLM_REQUEST_FAILED")]
)
async def test_lora_list_error_status(status: int, code: str) -> None:
    with pytest.raises(LlmError) as exc_info:
        await collect(failing(lambda request: httpx.Response(status)), chat_request())
    assert exc_info.value.code == code


async def test_model_still_loading_is_unavailable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/lora-adapters":
            return httpx.Response(200, json=[])
        loading = {"error": {"code": 503, "message": "Loading model", "type": "unavailable_error"}}
        return httpx.Response(503, json=loading)

    with pytest.raises(LlmError) as exc_info:
        await collect(failing(handler), chat_request())
    assert exc_info.value.code == "LLM_UNAVAILABLE"


@pytest.mark.parametrize("reply", [b"not json", b'[{"id": 0}]', b'{"id": 0}'])
async def test_bad_lora_list_reply(tmp_path: Path, reply: bytes) -> None:
    client = failing(lambda request: httpx.Response(200, content=reply))
    with pytest.raises(LlmError) as exc_info:
        await collect(client, chat_request(lora=tmp_path / "direction-v1.gguf"))
    assert exc_info.value.code == "LLM_REQUEST_FAILED"


@pytest.mark.parametrize(
    "data",
    [
        json.dumps({"error": {"message": "context exceeded"}}),
        "{truncated",
        "[1]",
        '{"choices": [1]}',
    ],
)
def test_bad_or_error_chunk_raises(data: str) -> None:
    with pytest.raises(LlmError) as exc_info:
        parse_chunk(data)
    assert exc_info.value.code == "LLM_REQUEST_FAILED"


def test_chunk_without_choices() -> None:
    assert parse_chunk(json.dumps({"choices": [], "usage": {}})) == []
