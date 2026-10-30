import json
from collections.abc import AsyncGenerator
from pathlib import Path

import pytest

from aiplot.generated.roles.card_output import CharacterCardOutput
from aiplot.generated.roles.source_output import SourceOutput
from aiplot.llm.client import ChatRequest, Delta, LlmError, Message
from aiplot.llm.config import LlmConfig, RoleConfig, load_llm_config
from aiplot.llm.fake import FakeClient, FakeResponse, load_fixtures
from aiplot.llm.router import Router

pytestmark = pytest.mark.anyio

TURNS: list[Message] = [{"role": "user", "content": "<원문>\n테오는 북부 항구 출신이다.\n</원문>"}]
SOURCE = json.dumps(
    {"edits": [], "added": ["테오는 북부 항구 출신이다."], "questions": [], "similar_names": []},
    ensure_ascii=False,
)


@pytest.fixture
def prompts(tmp_path: Path) -> Path:
    for role, config in load_llm_config().roles.items():
        (tmp_path / role).mkdir()
        (tmp_path / role / f"v{config.prompt}.md").write_text(
            f"<!-- 작성 메모 -->\n{role} 지시문\n<!-- 여러 줄\n메모 -->\n끝\n", encoding="utf-8"
        )
    return tmp_path


def with_role(config: LlmConfig, role: str, **changes: object) -> LlmConfig:
    roles = dict(config.roles)
    roles[role] = RoleConfig.model_validate({**roles[role].model_dump(), **changes})  # type: ignore[index]
    return LlmConfig(profiles=config.profiles, roles=roles)


def router(prompts: Path, client: FakeClient, config: LlmConfig | None = None) -> Router:
    return Router(
        config or load_llm_config(), client, lora_dir=prompts / "lora", prompts_dir=prompts
    )


async def test_request_puts_role_prompt_first(prompts: Path) -> None:
    request = router(prompts, FakeClient()).request("source", TURNS)
    assert request.messages[0] == {"role": "system", "content": "source 지시문\n끝"}
    assert request.messages[1:] == TURNS
    assert request.thinking is True
    assert request.thinking_kwarg == "enable_thinking"
    assert request.sampling.temperature == 0.3
    assert request.max_tokens == 4096
    assert request.lora is None


async def test_stream_text_drops_reasoning(prompts: Path) -> None:
    client = FakeClient({"chat": FakeResponse(content="테오는 몇 살인가요?", reasoning="x")})
    text = [t async for t in router(prompts, client).stream_text("chat", TURNS)]
    assert "".join(text) == "테오는 몇 살인가요?"
    assert client.requests[0].json_schema is None


async def test_stream_text_closes_client_stream_when_consumer_stops(prompts: Path) -> None:
    closed: list[bool] = []

    class Endless(FakeClient):
        async def stream(self, request: ChatRequest) -> AsyncGenerator[Delta, None]:
            try:
                while True:
                    yield Delta("content", "가")
            finally:
                closed.append(True)

    stream = router(prompts, Endless({})).stream_text("chat", TURNS)
    async for _ in stream:
        break
    await stream.aclose()
    assert closed == [True]


async def test_complete_json(prompts: Path) -> None:
    client = FakeClient({"source": FakeResponse(content=SOURCE, reasoning="근거")})
    result = await router(prompts, client).complete_json("source", TURNS, SourceOutput)
    assert result.value.added == ["테오는 북부 항구 출신이다."]
    assert result.reasoning == "근거"
    source_version = load_llm_config().roles["source"].prompt
    assert (result.meta.role, result.meta.prompt_version, result.meta.lora) == (
        "source",
        source_version,
        None,
    )
    assert result.meta.profile == "qwen3-8b-uncensor-q5km"
    assert client.requests[0].json_schema == SourceOutput.model_json_schema()
    assert result.usage is None


async def test_complete_json_never_accepts_truncated_reply(prompts: Path) -> None:
    # Valid JSON, but cut at max_tokens: the grammar can close it early.
    client = FakeClient({"source": FakeResponse(content=SOURCE, finish_reason="length")})
    with pytest.raises(LlmError) as exc_info:
        await router(prompts, client).complete_json("source", TURNS, SourceOutput)
    assert exc_info.value.code == "LLM_OUTPUT_TRUNCATED"
    assert len(client.requests) == 2


async def test_stream_ends_with_finish(prompts: Path) -> None:
    client = FakeClient({"chat": FakeResponse(content="네.")})
    deltas = [d async for d in router(prompts, client).stream("chat", TURNS)]
    assert [d.kind for d in deltas] == ["content", "finish"]
    assert deltas[-1].text == "stop"


async def test_complete_json_retries_once(prompts: Path) -> None:
    replies = iter(["{not json", SOURCE])

    class Flaky(FakeClient):
        async def stream(self, request: ChatRequest) -> AsyncGenerator[Delta, None]:
            self.requests.append(request)
            yield Delta("content", next(replies))

    client = Flaky({})
    result = await router(prompts, client).complete_json("source", TURNS, SourceOutput)
    assert result.value.questions == []
    assert len(client.requests) == 2


async def test_complete_json_gives_up_after_two_invalid(prompts: Path) -> None:
    client = FakeClient({"source": FakeResponse(content='{"notes": 1}')})
    with pytest.raises(LlmError) as exc_info:
        await router(prompts, client).complete_json("source", TURNS, SourceOutput)
    assert exc_info.value.code == "LLM_INVALID_OUTPUT"
    assert len(client.requests) == 2


async def test_role_not_configured(prompts: Path) -> None:
    with pytest.raises(LlmError) as exc_info:
        router(prompts, FakeClient()).request("write", TURNS)
    assert exc_info.value.code == "ROLE_NOT_CONFIGURED"


async def test_prompt_missing(prompts: Path) -> None:
    config = with_role(load_llm_config(), "chat", prompt=9)
    with pytest.raises(LlmError) as exc_info:
        router(prompts, FakeClient(), config).request("chat", TURNS)
    assert exc_info.value.code == "PROMPT_MISSING"


def install_lora(lora_dir: Path, lora_id: str, base: str) -> None:
    lora_dir.mkdir(exist_ok=True)
    manifest = {"id": lora_id, "file": f"{lora_id}.gguf", "sha256": "c" * 64, "base_sha256": base}
    (lora_dir / f"{lora_id}.json").write_text(json.dumps(manifest), encoding="utf-8")
    (lora_dir / f"{lora_id}.gguf").write_bytes(b"GGUF")


async def test_role_lora_resolved_for_profile_base(prompts: Path) -> None:
    base = load_llm_config().profile_for("card").gguf.sha256
    install_lora(prompts / "lora", "direction-v1", base)
    config = with_role(load_llm_config(), "card", lora="direction-v1")
    request = router(prompts, FakeClient(), config).request("card", TURNS)
    assert request.lora == prompts / "lora" / "direction-v1.gguf"


async def test_role_lora_for_other_base_is_refused(prompts: Path) -> None:
    install_lora(prompts / "lora", "direction-v1", "b" * 64)
    config = with_role(load_llm_config(), "card", lora="direction-v1")
    with pytest.raises(LlmError) as exc_info:
        router(prompts, FakeClient(), config).request("card", TURNS)
    assert exc_info.value.code == "LORA_UNAVAILABLE"


async def test_shipped_fake_fixtures_match_role_outputs(prompts: Path) -> None:
    client = FakeClient()
    assert set(load_fixtures()) == set(load_llm_config().roles)
    r = router(prompts, client)
    assert "".join([t async for t in r.stream_text("chat", TURNS)])
    await r.complete_json("source", TURNS, SourceOutput)
    # The card role constrains output to the requested type's variant.
    await r.complete_json("card", TURNS, CharacterCardOutput)
