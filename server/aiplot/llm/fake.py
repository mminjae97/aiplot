"""Fixture client for AIPLOT_FAKE_LLM=1 (tests, CI, GPU-less dev): no model, no network."""

import json
from collections.abc import AsyncGenerator, Mapping
from dataclasses import dataclass
from pathlib import Path

from aiplot.llm.client import ChatRequest, Delta, LlmError
from aiplot.llm.config import SERVER_DIR, Role

FIXTURES_DIR = SERVER_DIR / "tests" / "fixtures" / "llm"
# Small pieces so callers see a real stream (sentence splitting, cancellation).
CHUNK_CHARS = 8


@dataclass(frozen=True)
class FakeResponse:
    content: str
    reasoning: str = ""


def load_fixtures(directory: Path = FIXTURES_DIR) -> dict[str, FakeResponse]:
    """{role}.json: {"reasoning": str, "content": str | JSON value}."""
    responses: dict[str, FakeResponse] = {}
    for path in sorted(directory.glob("*.json")):
        raw = json.loads(path.read_text(encoding="utf-8"))
        content = raw["content"]
        if not isinstance(content, str):
            content = json.dumps(content, ensure_ascii=False)
        responses[path.stem] = FakeResponse(content=content, reasoning=raw.get("reasoning", ""))
    return responses


class FakeClient:
    def __init__(self, responses: Mapping[str, FakeResponse] | None = None) -> None:
        self.responses = dict(load_fixtures() if responses is None else responses)
        self.requests: list[ChatRequest] = []

    async def stream(self, request: ChatRequest) -> AsyncGenerator[Delta, None]:
        self.requests.append(request)
        response = self.responses.get(request.role)
        if response is None:
            raise LlmError("LLM_REQUEST_FAILED", f"no fake response for role {request.role}")
        if request.thinking:
            for piece in chunks(response.reasoning):
                yield Delta("reasoning", piece)
        for piece in chunks(response.content):
            yield Delta("content", piece)

    def respond(self, role: Role, response: FakeResponse) -> None:
        self.responses[role] = response


def chunks(text: str) -> list[str]:
    return [text[i : i + CHUNK_CHARS] for i in range(0, len(text), CHUNK_CHARS)]
