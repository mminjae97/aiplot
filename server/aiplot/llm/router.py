"""Role router: the only way services call an LLM (§5, §13).

A role's system prompt is its prompt file, sent first and unchanged on every call so the
llama.cpp prompt cache reuses it; callers pass the remaining turns (tagged context blocks).
"""

import re
from collections.abc import AsyncGenerator
from contextlib import aclosing
from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel, ValidationError

from aiplot.llm import lora
from aiplot.llm.client import ChatRequest, Delta, LlmClient, LlmError, Message, Usage
from aiplot.llm.config import PROMPTS_DIR, LlmConfig, Role, prompt_path

# Author notes in prompt files never reach the model.
COMMENT = re.compile(r"<!--.*?-->\n?", re.DOTALL)
JSON_ATTEMPTS = 2


@dataclass(frozen=True)
class OutputMeta:
    """Stored with every output (§5): which prompt, base and LoRA produced it."""

    role: Role
    prompt_version: int
    profile: str
    lora: str | None


@dataclass(frozen=True)
class JsonResult[T: BaseModel]:
    value: T
    reasoning: str
    meta: OutputMeta
    usage: Usage | None


class Router:
    def __init__(
        self,
        config: LlmConfig,
        client: LlmClient,
        *,
        lora_dir: Path,
        prompts_dir: Path = PROMPTS_DIR,
    ) -> None:
        self._config = config
        self._client = client
        self._lora_dir = lora_dir
        self._prompts_dir = prompts_dir
        self._prompts: dict[Role, str] = {}

    def meta(self, role: Role) -> OutputMeta:
        config = self._config.roles[role]
        return OutputMeta(role, config.prompt, config.profile, config.lora)

    def system_prompt(self, role: Role) -> str:
        if role not in self._prompts:
            path = prompt_path(role, self._config.roles[role].prompt, self._prompts_dir)
            try:
                text = path.read_text(encoding="utf-8")
            except OSError as exc:
                raise LlmError("PROMPT_MISSING", f"{role}: {exc}") from exc
            self._prompts[role] = COMMENT.sub("", text).strip()
        return self._prompts[role]

    def request(
        self, role: Role, turns: list[Message], json_schema: dict[str, object] | None = None
    ) -> ChatRequest:
        if role not in self._config.roles:
            raise LlmError("ROLE_NOT_CONFIGURED", f"role {role} is not in roles.yaml")
        config = self._config.roles[role]
        profile = self._config.profile_for(role)
        adapter = None
        if config.lora is not None:
            try:
                adapter = lora.resolve(self._lora_dir, config.lora, profile.gguf.sha256)
            except lora.LoraError as exc:
                raise LlmError("LORA_UNAVAILABLE", str(exc)) from exc
        system: Message = {"role": "system", "content": self.system_prompt(role)}
        return ChatRequest(
            role=role,
            messages=[system, *turns],
            thinking=config.thinking,
            thinking_kwarg=profile.thinking_kwarg,
            sampling=self._config.sampling_for(role),
            max_tokens=config.max_tokens,
            json_schema=json_schema,
            lora=adapter,
        )

    async def stream(self, role: Role, turns: list[Message]) -> AsyncGenerator[Delta, None]:
        """Every delta, ending with finish (reason + token usage)."""
        # aclosing: a consumer that stops early closes the HTTP stream, ending generation.
        async with aclosing(self._client.stream(self.request(role, turns))) as deltas:
            async for delta in deltas:
                yield delta

    async def stream_text(self, role: Role, turns: list[Message]) -> AsyncGenerator[str, None]:
        """Answer text as it arrives; reasoning is dropped."""
        async with aclosing(self.stream(role, turns)) as deltas:
            async for delta in deltas:
                if delta.kind == "content":
                    yield delta.text

    async def complete_json[T: BaseModel](
        self, role: Role, turns: list[Message], output: type[T]
    ) -> JsonResult[T]:
        """Schema-constrained JSON, validated; one retry on invalid or cut-off output (§20)."""
        request = self.request(role, turns, output.model_json_schema())
        error = LlmError("LLM_INVALID_OUTPUT", f"{role}: no attempt")
        for _ in range(JSON_ATTEMPTS):
            content: list[str] = []
            reasoning: list[str] = []
            finish: Delta | None = None
            async with aclosing(self._client.stream(request)) as deltas:
                async for delta in deltas:
                    if delta.kind == "finish":
                        finish = delta
                    else:
                        (content if delta.kind == "content" else reasoning).append(delta.text)
            if finish is not None and finish.text == "length":
                # Grammar-constrained JSON cut by max_tokens may still parse; never accept it.
                error = LlmError("LLM_OUTPUT_TRUNCATED", f"{role}: reply hit max_tokens")
                continue
            try:
                value = output.model_validate_json("".join(content))
            except ValidationError as exc:
                error = LlmError("LLM_INVALID_OUTPUT", f"{role}: {exc}")
                continue
            usage = finish.usage if finish is not None else None
            return JsonResult(value, "".join(reasoning), self.meta(role), usage)
        raise error
