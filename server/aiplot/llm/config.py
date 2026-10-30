"""config/roles.yaml and config/profiles/*.yaml (§13), validated at load."""

from pathlib import Path
from typing import Annotated, Literal, Self

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

SERVER_DIR = Path(__file__).resolve().parents[2]
CONFIG_DIR = SERVER_DIR / "config"
PROMPTS_DIR = SERVER_DIR / "prompts"

Role = Literal[
    "chat", "source", "card", "pick", "direct", "write", "check", "summary", "image_prompt"
]
Sha256 = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]

# Set from profile fields or by the process manager, never through server_args.
MANAGED_FLAGS = frozenset(
    {
        "-m",
        "--model",
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
        "--no-jinja",
    }
)


class ConfigError(Exception):
    pass


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


class Sampling(StrictModel):
    temperature: float = Field(ge=0, le=2)
    top_p: float = Field(gt=0, le=1)
    top_k: int = Field(ge=0)
    min_p: float = Field(ge=0, le=1)


class SamplingOverride(StrictModel):
    temperature: float | None = Field(default=None, ge=0, le=2)
    top_p: float | None = Field(default=None, gt=0, le=1)
    top_k: int | None = Field(default=None, ge=0)
    min_p: float | None = Field(default=None, ge=0, le=1)


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
    server_args: list[str]
    sampling: ProfileSampling

    @model_validator(mode="after")
    def no_managed_flags(self) -> Self:
        managed = sorted(MANAGED_FLAGS.intersection(self.server_args))
        if managed:
            raise ValueError(f"server_args must not set {managed}")
        return self


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
        return self

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
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise ConfigError(f"{path.name}: {exc}") from exc


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
