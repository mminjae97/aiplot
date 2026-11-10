"""The style framework the write role follows (§10): `data/style/{id}-v{n}.md`.

A file has a front matter (id, version) and `## key` sections. role, summary, rules, dialogue,
format and the plain banned phrases go into every beat's prompt, byte-identical, so the prompt
cache reuses them; examples and the by_* subsections go in only when they match the beat.
Banned phrases and /regex/ patterns are also checked against what was written.
"""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from aiplot.llm.config import SERVER_DIR

STYLE_DIR = SERVER_DIR / "data" / "style"

FRONT_MATTER = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)
COMMENT = re.compile(r"<!--.*?-->\n?", re.DOTALL)
SECTION = re.compile(r"^## (\w+)[ \t]*\n(.*?)(?=^## |\Z)", re.DOTALL | re.MULTILINE)
SUBSECTION = re.compile(r"^### (.+?)[ \t]*\n(.*?)(?=^### |\Z)", re.DOTALL | re.MULTILINE)
APPLIES = re.compile(r"\A적용:(.*)\n?")
TENSION_RANGE = re.compile(r"\A([1-5])(?:-([1-5]))?\Z")
# Every beat, in this order, after the role line.
EVERY_BEAT = ("summary", "rules", "dialogue", "format")
BANNED_LABEL = "금지 표현"
# The beat values (§9) a by_mode, by_focus or by_density heading may name.
BEAT_VALUES: dict[str, frozenset[str]] = {
    "by_mode": frozenset({"장면화", "요약"}),
    "by_focus": frozenset({"감정", "행동", "정보"}),
    "by_density": frozenset({"담백", "자세히"}),
}
EXAMPLE_VALUES = frozenset().union(*BEAT_VALUES.values())


class StyleError(ValueError):
    """The style file is missing or cannot be read as a style framework."""


@dataclass(frozen=True)
class Example:
    title: str
    body: str
    # Values of mode, focus or density the example is for; empty = every beat.
    applies: frozenset[str]


@dataclass(frozen=True)
class Style:
    id: str
    version: int
    # The role declaration: the first line of the system prompt.
    role: str
    # The other every-beat sections and the plain banned phrases, the same for every beat.
    every_beat: str
    banned_phrases: tuple[str, ...]
    banned_patterns: tuple[re.Pattern[str], ...]
    examples: tuple[Example, ...]
    # by_mode, by_focus, by_density, by_pov, by_tension -> heading -> text (non-empty only).
    by: Mapping[str, Mapping[str, str]]

    def for_beat(self, *, mode: str, focus: str, density: str, pov: str, tension: int) -> str:
        """The sections matching the beat: by_mode, by_focus, by_density (heading = the beat's
        value), by_pov (heading within the beat's pov), by_tension (heading `3` or `1-2`), then
        the examples for it. Empty when nothing matches."""
        parts = [
            self.by["by_mode"].get(mode, ""),
            self.by["by_focus"].get(focus, ""),
            self.by["by_density"].get(density, ""),
            *(text for heading, text in self.by["by_pov"].items() if heading in pov),
            *(
                text
                for heading, text in self.by["by_tension"].items()
                if tension_matches(heading, tension)
            ),
        ]
        values = {mode, focus, density}
        parts += [
            f"예시: {example.title}\n{example.body}"
            for example in self.examples
            if not example.applies or example.applies & values
        ]
        return "\n\n".join(part for part in parts if part)

    def banned_in(self, text: str) -> list[str]:
        """The banned phrases and patterns found in a beat's text, as written in the file."""
        found = [phrase for phrase in self.banned_phrases if phrase in text]
        found += [
            f"/{pattern.pattern}/" for pattern in self.banned_patterns if pattern.search(text)
        ]
        return found


def tension_matches(heading: str, tension: int) -> bool:
    match = TENSION_RANGE.match(heading)
    if match is None:
        return False
    low = int(match.group(1))
    high = int(match.group(2) or low)
    return low <= tension <= high


def style_path(style_id: str, version: int, style_dir: Path = STYLE_DIR) -> Path:
    return style_dir / f"{style_id}-v{version}.md"


def load_style(style_id: str, version: int, style_dir: Path = STYLE_DIR) -> Style:
    path = style_path(style_id, version, style_dir)
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise StyleError(f"style {path.name}: {exc}") from exc
    return parse_style(text, style_id, version, path.name)


def parse_style(text: str, style_id: str, version: int, name: str = "style") -> Style:
    front = FRONT_MATTER.match(text)
    if front is None:
        raise StyleError(f"{name}: no front matter")
    meta = dict(
        (key.strip(), value.strip())
        for key, _, value in (
            line.partition(":") for line in front.group(1).splitlines() if not line.startswith("#")
        )
    )
    if meta.get("id") != style_id or meta.get("version") != str(version):
        raise StyleError(f"{name}: front matter must say id {style_id}, version {version}")
    body = COMMENT.sub("", text[front.end() :])
    sections = {key: value.strip() for key, value in SECTION.findall(body)}
    if not sections.get("role"):
        raise StyleError(f"{name}: the role section is empty")
    phrases: list[str] = []
    patterns: list[re.Pattern[str]] = []
    for line in sections.get("banned", "").splitlines():
        if not line.startswith("- "):
            continue
        item = line[2:].strip()
        if len(item) > 2 and item.startswith("/") and item.endswith("/"):
            try:
                patterns.append(re.compile(item[1:-1]))
            except re.error as exc:
                raise StyleError(f"{name}: banned pattern {item}: {exc}") from exc
        elif item:
            phrases.append(item)
    parts = [sections.get(key, "") for key in EVERY_BEAT]
    if phrases:
        parts.append(f"{BANNED_LABEL}: " + ", ".join(f'"{phrase}"' for phrase in phrases))
    by = {
        key: subsections(sections.get(key, ""))
        for key in ("by_mode", "by_focus", "by_density", "by_pov", "by_tension")
    }
    # A heading no beat can match would be left out without a word.
    for key, allowed in BEAT_VALUES.items():
        unknown = sorted(set(by[key]) - allowed)
        if unknown:
            raise StyleError(f"{name}: {key} has unknown headings {unknown}")
    unknown = sorted(h for h in by["by_tension"] if TENSION_RANGE.match(h) is None)
    if unknown:
        raise StyleError(f"{name}: by_tension has unknown headings {unknown}")
    found = examples(sections.get("examples", ""))
    for example in found:
        unknown = sorted(example.applies - EXAMPLE_VALUES)
        if unknown:
            raise StyleError(f"{name}: example {example.title}: unknown values {unknown}")
    return Style(
        id=style_id,
        version=version,
        role=sections["role"],
        every_beat="\n\n".join(part for part in parts if part),
        banned_phrases=tuple(phrases),
        banned_patterns=tuple(patterns),
        examples=tuple(found),
        by=by,
    )


def subsections(section: str) -> dict[str, str]:
    """heading -> text, without the empty ones."""
    found = {heading.strip(): text.strip() for heading, text in SUBSECTION.findall(section)}
    return {heading: text for heading, text in found.items() if text}


def examples(section: str) -> list[Example]:
    found = []
    for title, text in subsections(section).items():
        applies = APPLIES.match(text)
        values = frozenset(
            value.strip() for value in (applies.group(1) if applies else "").split(",")
        ) - {""}
        body = text[applies.end() :].strip() if applies else text
        if body:
            found.append(Example(title, body, values))
    return found
