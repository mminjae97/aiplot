import shutil
from pathlib import Path

import pytest
import yaml

from aiplot.llm.config import CONFIG_DIR, ConfigError, load_llm_config, prompt_path

Q4 = "qwen3-8b-uncensor-q4km"


@pytest.fixture
def config_dir(tmp_path: Path) -> Path:
    return Path(shutil.copytree(CONFIG_DIR, tmp_path / "config"))


def edit(path: Path, change: dict[str, object]) -> None:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    data.update(change)
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")


def edit_role(config_dir: Path, role: str, change: dict[str, object]) -> None:
    path = config_dir / "roles.yaml"
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    data["roles"][role].update(change)
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")


def test_shipped_config_loads() -> None:
    config = load_llm_config()
    assert set(config.roles) == {"chat", "source", "card"}
    assert set(config.profiles) == {Q4, "qwen3-8b-uncensor-q5km"}
    assert all(role.profile == Q4 for role in config.roles.values())
    assert config.profile_for("chat").gguf.file == "Qwen3-8B-Uncensor-v2.Q4_K_M.gguf"


def test_profiles_differ_only_in_model_file() -> None:
    q4, q5 = load_llm_config().profiles.values()
    assert q4.model_dump(exclude={"id", "gguf"}) == q5.model_dump(exclude={"id", "gguf"})


def test_sampling_uses_thinking_defaults_then_role_overrides() -> None:
    config = load_llm_config()
    chat = config.sampling_for("chat")
    assert (chat.temperature, chat.top_p) == (0.7, 0.8)
    source = config.sampling_for("source")
    assert (source.temperature, source.top_p, source.top_k) == (0.3, 0.95, 20)


def test_prompt_path(tmp_path: Path) -> None:
    assert prompt_path("card", 2, tmp_path) == tmp_path / "card" / "v2.md"


def test_profile_id_must_match_file_name(config_dir: Path) -> None:
    edit(config_dir / "profiles" / f"{Q4}.yaml", {"id": "other"})
    with pytest.raises(ConfigError, match="must match the file name"):
        load_llm_config(config_dir)


def test_role_with_unknown_profile(config_dir: Path) -> None:
    edit_role(config_dir, "chat", {"profile": "missing"})
    with pytest.raises(ConfigError, match="unknown profile"):
        load_llm_config(config_dir)


@pytest.mark.parametrize("flag", ["-c", "--port", "-m", "--lora", "--no-jinja"])
def test_server_args_reject_managed_flags(config_dir: Path, flag: str) -> None:
    edit(config_dir / "profiles" / f"{Q4}.yaml", {"server_args": [flag, "1"]})
    with pytest.raises(ConfigError, match="server_args must not set"):
        load_llm_config(config_dir)


@pytest.mark.parametrize(
    "change",
    [
        {"prompt": "1"},
        {"prompt": 0},
        {"thinking": "yes"},
        {"max_tokens": 0},
        {"sampling": {"temperature": 3}},
        {"sampling": {"seed": 1}},
        {"extra": True},
    ],
)
def test_role_fields_are_strict(config_dir: Path, change: dict[str, object]) -> None:
    edit_role(config_dir, "source", change)
    with pytest.raises(ConfigError):
        load_llm_config(config_dir)


def test_unknown_role_rejected(config_dir: Path) -> None:
    path = config_dir / "roles.yaml"
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    data["roles"]["poet"] = data["roles"]["chat"]
    path.write_text(yaml.safe_dump(data), encoding="utf-8")
    with pytest.raises(ConfigError):
        load_llm_config(config_dir)


@pytest.mark.parametrize(
    "gguf",
    [
        {"file": "../x.gguf"},
        {"file": "x.bin"},
        {"sha256": "ABC"},
        {"size": 0},
        {"source": "http://example.com/x.gguf"},
    ],
)
def test_gguf_pin_validated(config_dir: Path, gguf: dict[str, object]) -> None:
    path = config_dir / "profiles" / f"{Q4}.yaml"
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    data["gguf"].update(gguf)
    path.write_text(yaml.safe_dump(data), encoding="utf-8")
    with pytest.raises(ConfigError):
        load_llm_config(config_dir)


def test_broken_yaml(config_dir: Path) -> None:
    (config_dir / "roles.yaml").write_text("roles: [", encoding="utf-8")
    with pytest.raises(ConfigError, match=r"roles\.yaml"):
        load_llm_config(config_dir)
