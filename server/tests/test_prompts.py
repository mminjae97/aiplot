from pathlib import Path

import pytest

from aiplot.llm.config import PROMPTS_DIR, load_llm_config, prompt_path
from aiplot.llm.fake import FakeClient
from aiplot.llm.router import Router

CONFIG = load_llm_config()


@pytest.mark.parametrize("role", sorted(CONFIG.roles))
def test_configured_prompt_exists_without_comments(role: str) -> None:
    router = Router(CONFIG, FakeClient({}), lora_dir=Path("unused"))
    text = router.system_prompt(role)  # type: ignore[arg-type]
    assert text
    assert "<!--" not in text
    assert "-->" not in text


def test_prompt_files_are_versioned() -> None:
    for path in PROMPTS_DIR.rglob("*"):
        if path.is_file():
            assert path.parent.parent == PROMPTS_DIR, path
            assert path.name.startswith("v") and path.suffix == ".md", path
            assert path.stem[1:].isdigit(), path


def test_roles_use_latest_prompt_version() -> None:
    # Older versions stay for outputs that recorded them; config moves to the newest.
    for role, config in CONFIG.roles.items():
        versions = [int(p.stem[1:]) for p in (PROMPTS_DIR / role).glob("v*.md")]
        assert config.prompt == max(versions), role
        assert prompt_path(role, config.prompt).is_file()
