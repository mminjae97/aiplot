"""The style framework (§10): what every beat gets, what only a matching beat gets, the banned
phrases checked in the written text, and the write role's system prompt built from it."""

from pathlib import Path
from typing import Any

import pytest

from aiplot.llm.client import LlmError
from aiplot.llm.config import LlmConfig, RoleConfig, load_llm_config
from aiplot.llm.fake import FakeClient
from aiplot.llm.router import Router
from aiplot.llm.style import STYLE_DIR, StyleError, load_style, parse_style

SAMPLE = """---
# 주석 줄
id: sample
version: 2
---

<!--
작성 안내
-->

## role
<!-- 첫 줄 -->
너는 작가다.

## summary
짧게 쓴다.

## rules
- [필수] 보여 준다.

## banned
<!-- 쓰지 않을 표현 -->
- 그는 슬펐다
- 운명의 톱니바퀴
- /^\\s*(알겠습니다|네,)/
- /하지만 그[들는]은? 알지 못했다/

## examples
### 늘 넣는 예
좋은 예: 숨이 걸렸다.

### 감정 예
적용: 감정, 자세히

좋은 예: 눈꺼풀이 떨렸다.

### 빈 예

## by_mode
### 장면화
- 지금 이 순간을 보여 준다.

### 요약

## by_focus
### 감정
- 감정에 머문다.

## by_density
### 담백
- 꾸밈없이 쓴다.

## by_pov
### 1인칭
- '나'의 눈으로만 본다.

## by_tension
### 1-2
- 느슨하게 쓴다.

### 5
- 문장을 끊는다.

## dialogue
- 구어체로 쓴다.

## format
- 본문만 쓴다.
"""


def beat(**changes: Any) -> dict[str, Any]:
    return {
        "mode": "요약",
        "focus": "행동",
        "density": "자세히",
        "pov": "3인칭 관찰",
        "tension": 3,
        **changes,
    }


def test_every_beat_sections_come_in_a_fixed_order_without_comments() -> None:
    style = parse_style(SAMPLE, "sample", 2)
    assert (style.id, style.version, style.role) == ("sample", 2, "너는 작가다.")
    assert style.every_beat == (
        "짧게 쓴다.\n\n- [필수] 보여 준다.\n\n- 구어체로 쓴다.\n\n- 본문만 쓴다.\n\n"
        '금지 표현: "그는 슬펐다", "운명의 톱니바퀴"'
    )
    # Patterns are only checked, never shown.
    assert "알겠습니다" not in style.every_beat


def test_only_matching_sections_go_with_a_beat() -> None:
    style = parse_style(SAMPLE, "sample", 2)
    always = "예시: 늘 넣는 예\n좋은 예: 숨이 걸렸다."
    # 요약 has no text, 행동 no subsection, 자세히 no subsection, tension 3 no heading.
    assert style.for_beat(**beat(density="보통")) == always
    matched = style.for_beat(
        **beat(mode="장면화", focus="감정", density="담백", pov="테오 1인칭", tension=2)
    )
    assert matched == "\n\n".join(
        [
            "- 지금 이 순간을 보여 준다.",
            "- 감정에 머문다.",
            "- 꾸밈없이 쓴다.",
            "- '나'의 눈으로만 본다.",
            "- 느슨하게 쓴다.",
            always,
            "예시: 감정 예\n좋은 예: 눈꺼풀이 떨렸다.",
        ]
    )
    # An example applies when any of mode, focus or density is one of its values.
    assert "감정 예" in style.for_beat(**beat())
    assert "감정 예" not in style.for_beat(**beat(density="담백"))
    assert "- 문장을 끊는다." in style.for_beat(**beat(tension=5))
    assert "- 느슨하게 쓴다." in style.for_beat(**beat(tension=1))
    assert "느슨하게" not in style.for_beat(**beat(tension=3))


def test_banned_phrases_and_patterns_are_found_in_the_text() -> None:
    style = parse_style(SAMPLE, "sample", 2)
    assert style.banned_in("테오는 배에서 내렸다.") == []
    assert style.banned_in("그는 슬펐다. 운명의 톱니바퀴가 돌았다.") == [
        "그는 슬펐다",
        "운명의 톱니바퀴",
    ]
    # ^ is the beat's start only: no multiline.
    assert style.banned_in("  알겠습니다. 테오는") == ["/^\\s*(알겠습니다|네,)/"]
    assert style.banned_in("테오는 말했다.\n알겠습니다.") == []
    assert style.banned_in("하지만 그는 알지 못했다.") == ["/하지만 그[들는]은? 알지 못했다/"]


@pytest.mark.parametrize(
    ("text", "message"),
    [
        (SAMPLE.replace("---\n", "", 1), "front matter"),
        (SAMPLE.replace("version: 2", "version: 3"), "version 2"),
        (SAMPLE.replace("id: sample", "id: other"), "id sample"),
        (SAMPLE.replace("너는 작가다.\n", ""), "role"),
        (SAMPLE.replace("/^\\s*(알겠습니다|네,)/", "/(/"), "banned pattern"),
    ],
)
def test_a_broken_style_file_is_refused(text: str, message: str) -> None:
    with pytest.raises(StyleError, match=message):
        parse_style(text, "sample", 2)


def test_a_missing_style_file_is_refused(tmp_path: Path) -> None:
    with pytest.raises(StyleError):
        load_style("sample", 1, tmp_path)


def test_shipped_styles_load() -> None:
    for path in sorted(STYLE_DIR.glob("*.md")):
        style_id, _, version = path.stem.rpartition("-v")
        style = load_style(style_id, int(version))
        assert style.role and style.every_beat
        assert style.banned_phrases and style.banned_patterns


def test_v3_keeps_density_apart_from_focus_and_mode() -> None:
    style = load_style("webnovel-style", 3)
    assert set(style.by["by_density"]) == {"담백", "자세히"}
    assert set(style.by["by_focus"]) == {"감정", "행동", "정보"}
    assert set(style.by["by_mode"]) == {"장면화", "요약"}
    # v2's every-beat sections are unchanged: the measured prefix stays.
    assert style.every_beat == load_style("webnovel-style", 2).every_beat
    plain = style.for_beat(**beat(mode="요약", focus="정보", density="담백"))
    detailed = style.for_beat(**beat(mode="장면화", focus="감정", density="자세히"))
    assert "아낀다" in plain and "아낀다" not in detailed
    assert "서두르지 않는다" in detailed and "서두르지 않는다" not in plain
    # The 감정 example goes with 감정 beats only.
    assert "예시:" in detailed and "예시:" not in plain


# the write role ------------------------------------------------------------------------------


def router(tmp_path: Path, config: LlmConfig | None = None, **dirs: Path) -> Router:
    return Router(config or load_llm_config(), FakeClient({}), lora_dir=tmp_path / "lora", **dirs)


def test_the_write_role_uses_the_newest_style() -> None:
    ref = load_llm_config().roles["write"].style
    assert ref is not None
    versions = [int(p.stem.rpartition("-v")[2]) for p in STYLE_DIR.glob(f"{ref.id}-v*.md")]
    assert ref.version == max(versions)
    assert all(
        config.style is None for role, config in load_llm_config().roles.items() if role != "write"
    )


def test_the_write_system_prompt_is_role_then_prompt_then_every_beat_sections(
    tmp_path: Path,
) -> None:
    prompts = tmp_path / "prompts"
    styles = tmp_path / "styles"
    (prompts / "write").mkdir(parents=True)
    styles.mkdir()
    version = load_llm_config().roles["write"].prompt
    (prompts / "write" / f"v{version}.md").write_text("<!-- 메모 -->\n비트를 쓴다.\n", "utf-8")
    (styles / "webnovel-style-v3.md").write_text(
        SAMPLE.replace("id: sample", "id: webnovel-style").replace("version: 2", "version: 3"),
        "utf-8",
    )
    made = router(tmp_path, prompts_dir=prompts, style_dir=styles)
    style = made.style("write")
    assert style is not None
    system = made.system_prompt("write")
    assert system == f"너는 작가다.\n\n비트를 쓴다.\n\n{style.every_beat}"
    # The same text on every call (the prompt cache), whatever the beat.
    turns = [{"role": "user", "content": "<지시>\n내용\n</지시>"}]
    request = made.request("write", turns)  # type: ignore[arg-type]
    assert request.messages[0] == {"role": "system", "content": system}
    assert request.thinking is False
    assert (request.sampling.temperature, request.sampling.presence_penalty) == (0.8, 1.5)
    meta = made.meta("write")
    assert (meta.prompt_version, meta.style_id, meta.style_version) == (
        version,
        "webnovel-style",
        3,
    )
    assert made.style("chat") is None
    assert (made.meta("chat").style_id, made.meta("chat").style_version) == (None, None)


def test_a_missing_style_is_a_missing_prompt(tmp_path: Path) -> None:
    config = load_llm_config()
    roles = dict(config.roles)
    roles["write"] = RoleConfig.model_validate(
        {**roles["write"].model_dump(), "style": {"id": "webnovel-style", "version": 99}}
    )
    made = router(tmp_path, LlmConfig(profiles=config.profiles, roles=roles))
    with pytest.raises(LlmError) as exc_info:
        made.system_prompt("write")
    assert exc_info.value.code == "PROMPT_MISSING"


def test_the_shipped_write_prompt_holds_the_style(tmp_path: Path) -> None:
    made = router(tmp_path)
    style = made.style("write")
    assert style is not None
    system = made.system_prompt("write")
    assert system.startswith(style.role + "\n\n")
    assert system.endswith(style.every_beat)
    assert "<!--" not in system
