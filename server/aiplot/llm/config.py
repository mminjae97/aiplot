"""config/roles.yaml and config/profiles/*.yaml (§13), validated at load."""

from collections.abc import Hashable
from pathlib import Path
from typing import Annotated, Any, Literal, Self

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

SERVER_DIR = Path(__file__).resolve().parents[2]
CONFIG_DIR = SERVER_DIR / "config"
PROMPTS_DIR = SERVER_DIR / "prompts"

Role = Literal[
    "chat", "source", "card", "pick", "direct", "write", "check", "summary", "image_prompt"
]
Sha256 = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]

# Set from profile fields, per request or by the process manager, or forbidden (runtime
# downloads, KV shifting); never through server_args.
MANAGED_FLAGS = frozenset(
    {
        "-m",
        "--model",
        "-hf",
        "--hf-repo",
        "-hff",
        "--hf-file",
        "-mu",
        "--model-url",
        "-c",
        "--ctx-size",
        "-ctk",
        "--cache-type-k",
        "-ctv",
        "--cache-type-v",
        "--host",
        "--port",
        "--lora",
        "--lora-scaled",
        "--chat-template",
        "--chat-template-file",
        "--chat-template-kwargs",
        "--no-jinja",
        "--reasoning-format",
        "--reasoning-budget",
        "--cache-reuse",
    }
)


class UniqueKeyLoader(yaml.SafeLoader):
    """safe_load that rejects repeated mapping keys instead of keeping the last one."""

    def construct_mapping(self, node: yaml.MappingNode, deep: bool = False) -> dict[Hashable, Any]:
        seen: set[object] = set()
        for key_node, _ in node.value:
            key = self.construct_object(key_node, deep=deep)
            if key in seen:
                raise yaml.constructor.ConstructorError(
                    None, None, f"duplicate key {key!r}", key_node.start_mark
                )
            seen.add(key)
        return super().construct_mapping(node, deep)


class ConfigError(Exception):
    pass


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


class Sampling(StrictModel):
    temperature: float = Field(ge=0, le=2)
    top_p: float = Field(gt=0, le=1)
    top_k: int = Field(ge=0)
    min_p: float = Field(ge=0, le=1)
    # Repetition control; 0 = off. dry_multiplier enables llama.cpp's DRY sampler.
    presence_penalty: float = Field(default=0.0, ge=0, le=2)
    dry_multiplier: float = Field(default=0.0, ge=0, le=5)


class SamplingOverride(StrictModel):
    temperature: float | None = Field(default=None, ge=0, le=2)
    top_p: float | None = Field(default=None, gt=0, le=1)
    top_k: int | None = Field(default=None, ge=0)
    min_p: float | None = Field(default=None, ge=0, le=1)
    presence_penalty: float | None = Field(default=None, ge=0, le=2)
    dry_multiplier: float | None = Field(default=None, ge=0, le=5)


class ProfileSampling(StrictModel):
    thinking: Sampling
    no_thinking: Sampling


class Gguf(StrictModel):
    file: str = Field(pattern=r"^[^/\\:]+\.gguf$")
    size: int = Field(gt=0)
    sha256: Sha256
    source: str = Field(pattern=r"^https://")


class Profile(StrictModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$")
    gguf: Gguf
    chat_template: Literal["embedded"]
    thinking_kwarg: str
    ctx: int = Field(gt=0)
    kv_type: Literal["f16", "q8_0"]
    lora_mode: Literal["hotswap", "merged"]
    # Tuple so a loaded profile cannot gain flags after validation; YAML gives a list.
    server_args: tuple[str, ...] = Field(strict=False)
    sampling: ProfileSampling

    @model_validator(mode="after")
    def no_managed_flags(self) -> Self:
        names = {arg.split("=", 1)[0] for arg in self.server_args}
        managed = sorted(MANAGED_FLAGS & names)
        if managed:
            raise ValueError(f"server_args must not set {managed}")
        return self


class LlamaArchive(StrictModel):
    file: str = Field(pattern=r"^[^/\\:]+\.zip$")
    url: str = Field(pattern=r"^https://")
    size: int = Field(gt=0)
    sha256: Sha256


class LlamaBuild(StrictModel):
    """config/llama.yaml: the pinned llama.cpp server build (§2)."""

    build: str = Field(pattern=r"^b[0-9]+$")
    cuda: str = Field(pattern=r"^[0-9]+\.[0-9]+$")
    dir: str = Field(pattern=r"^[^/\\:]+$")
    executable: str = Field(pattern=r"^[^/\\:]+\.exe$")
    archives: tuple[LlamaArchive, ...] = Field(strict=False, min_length=1)


class RoleConfig(StrictModel):
    profile: str
    lora: str | None
    prompt: int = Field(ge=1)
    thinking: bool
    sampling: SamplingOverride = SamplingOverride()
    max_tokens: int = Field(gt=0)


class RolesFile(StrictModel):
    roles: dict[Role, RoleConfig]


class LlmConfig(StrictModel):
    profiles: dict[str, Profile]
    roles: dict[Role, RoleConfig]

    @model_validator(mode="after")
    def roles_use_known_profiles(self) -> Self:
        for role, config in self.roles.items():
            if config.profile not in self.profiles:
                raise ValueError(f"role {role}: unknown profile {config.profile!r}")
        used = {config.profile for config in self.roles.values()}
        if len(used) > 1:
            # One llama-server holds one model in 8 GB VRAM; LoRAs vary per role, the base not.
            raise ValueError(f"all roles must use one base profile, got {sorted(used)}")
        return self

    @property
    def base(self) -> Profile:
        """The one base profile every role uses."""
        return self.profiles[next(iter(self.roles.values())).profile]

    def profile_for(self, role: Role) -> Profile:
        return self.profiles[self.roles[role].profile]

    def sampling_for(self, role: Role) -> Sampling:
        config = self.roles[role]
        profile = self.profiles[config.profile]
        base = profile.sampling.thinking if config.thinking else profile.sampling.no_thinking
        overrides = config.sampling.model_dump(exclude_none=True)
        return base.model_copy(update=overrides)


def prompt_path(role: Role, version: int, prompts_dir: Path = PROMPTS_DIR) -> Path:
    return prompts_dir / role / f"v{version}.md"


def read_yaml(path: Path) -> object:
    try:
        return yaml.load(path.read_text(encoding="utf-8"), Loader=UniqueKeyLoader)
    except (OSError, yaml.YAMLError) as exc:
        raise ConfigError(f"{path.name}: {exc}") from exc


def load_llama_build(config_dir: Path = CONFIG_DIR) -> LlamaBuild:
    try:
        return LlamaBuild.model_validate(read_yaml(config_dir / "llama.yaml"))
    except ValueError as exc:
        raise ConfigError(str(exc)) from exc


def load_llm_config(config_dir: Path = CONFIG_DIR) -> LlmConfig:
    try:
        profiles: dict[str, Profile] = {}
        for path in sorted((config_dir / "profiles").glob("*.yaml")):
            profile = Profile.model_validate(read_yaml(path))
            if profile.id != path.stem:
                raise ConfigError(f"{path.name}: id {profile.id!r} must match the file name")
            profiles[profile.id] = profile
        roles = RolesFile.model_validate(read_yaml(config_dir / "roles.yaml")).roles
        return LlmConfig(profiles=profiles, roles=roles)
    except ValueError as exc:
        # pydantic.ValidationError is a ValueError.
        raise ConfigError(str(exc)) from exc
