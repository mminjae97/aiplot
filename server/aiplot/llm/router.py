"""Role router: the only way services call an LLM (§5, §13).

A role's system prompt is its prompt file, sent first and unchanged on every call so the
llama.cpp prompt cache reuses it; callers pass the remaining turns (tagged context blocks).
A role with a style framework (write, §10) gets the style's role line before the prompt file
and its every-beat sections after it, the same on every call too.
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
from aiplot.llm.style import STYLE_DIR, Style, StyleError, load_style

# Author notes in prompt files never reach the model.
COMMENT = re.compile(r"<!--.*?-->\n?", re.DOTALL)
JSON_ATTEMPTS = 2


@dataclass(frozen=True)
class OutputMeta:
    """Stored with every output (§5): which prompt, base, LoRA and style produced it."""

    role: Role
    prompt_version: int
    profile: str
    lora: str | None
    style_id: str | None = None
    style_version: int | None = None


@dataclass(frozen=True)
class JsonResult[T: BaseModel]:
    value: T
    reasoning: str
    meta: OutputMeta
    usage: Usage | None
    # Model calls made, the retry after an invalid or cut-off reply included.
    attempts: int = 1


class Router:
    def __init__(
        self,
        config: LlmConfig,
        client: LlmClient,
        *,
        lora_dir: Path,
        prompts_dir: Path = PROMPTS_DIR,
        style_dir: Path = STYLE_DIR,
    ) -> None:
        self._config = config
        self._client = client
        self._lora_dir = lora_dir
        self._prompts_dir = prompts_dir
        self._style_dir = style_dir
        self._prompts: dict[Role, str] = {}
        self._styles: dict[Role, Style] = {}

    def meta(self, role: Role) -> OutputMeta:
        config = self._config.roles[role]
        style = config.style
        return OutputMeta(
            role,
            config.prompt,
            config.profile,
            config.lora,
            style.id if style else None,
            style.version if style else None,
        )

    def style(self, role: Role) -> Style | None:
        """The role's style framework (roles.yaml), read once; None for roles without one."""
        if role not in self._config.roles:
            raise LlmError("ROLE_NOT_CONFIGURED", f"role {role} is not in roles.yaml")
        ref = self._config.roles[role].style
        if ref is None:
            return None
        if role not in self._styles:
            try:
                self._styles[role] = load_style(ref.id, ref.version, self._style_dir)
            except StyleError as exc:
                raise LlmError("PROMPT_MISSING", f"{role}: {exc}") from exc
        return self._styles[role]

    def system_prompt(self, role: Role) -> str:
        if role not in self._prompts:
            path = prompt_path(role, self._config.roles[role].prompt, self._prompts_dir)
            try:
                text = path.read_text(encoding="utf-8")
            except OSError as exc:
                raise LlmError("PROMPT_MISSING", f"{role}: {exc}") from exc
            prompt = COMMENT.sub("", text).strip()
            style = self.style(role)
            if style is not None:
                parts = (style.role, prompt, style.every_beat)
                prompt = "\n\n".join(part for part in parts if part)
            self._prompts[role] = prompt
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
        self,
        role: Role,
        turns: list[Message],
        output: type[T],
        json_schema: dict[str, object] | None = None,
    ) -> JsonResult[T]:
        """Schema-constrained JSON, validated; one retry on invalid or cut-off output (§20).
        json_schema replaces the output model's schema as the constraint (e.g. narrowed to this
        call's values); the reply is still validated against the model."""
        schema = output.model_json_schema() if json_schema is None else json_schema
        request = self.request(role, turns, schema)
        error = LlmError("LLM_INVALID_OUTPUT", f"{role}: no attempt")
        for attempt in range(1, JSON_ATTEMPTS + 1):
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
            return JsonResult(value, "".join(reasoning), self.meta(role), usage, attempt)
        raise error
