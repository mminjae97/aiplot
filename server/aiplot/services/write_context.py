"""What the write role sees for one beat (§10): after the system message (the style's every-beat
sections, the same on every call), one user message of the beat's matching style sections and
the tagged blocks `<참고 카드> <상태> <원문> <지시>`.

The texts here are model input, not UI text: they follow prompts/write. Cards come from the
episode's relation tables (§6); inactive (incomplete) ones are left out (§11). Technique
examples never reach a prompt (§9): a beat's cards give only their prompt_hint.

The sizes are in characters, drafts for §10's token shares until the step 7 length run.
"""

import re
import sqlite3
from collections.abc import Sequence
from dataclasses import dataclass

from aiplot.db import cards as cards_db
from aiplot.db import chapters as chapters_db
from aiplot.db import plans as plans_db
from aiplot.db import techniques as techniques_db
from aiplot.llm.client import Message
from aiplot.llm.style import Style
from aiplot.services.direction_context import about, active_cards, labelled
from aiplot.services.draft_context import CATEGORY, block

# §10: summaries ≤2000 chars; the last ~200 chars of the manuscript: enough to go on from, too
# little to copy (step 7 runs 2 and 4: with 1000 chars 296/457 lines of the later beats were
# copied from it, with 200 chars 45/237).
SUMMARY_CHARS = 2000
PREVIOUS_CHARS = 200
# Appearing characters with their speech (~1000 tokens) and the world cards (~400 tokens).
CHARACTER_CHARS = 1500
WORLD_CHARS = 600
SPEECH_EXAMPLES = 3
# A sentence's end with the closing quotes after it.
SENTENCE_END = re.compile(r"[.?!…][\"'”’」』]*\s+")  # noqa: RUF001


class BeatNotFoundError(LookupError):
    pass


def count_chars(text: str) -> int:
    """Characters incl. spaces (§6: counted in code); line breaks are not counted."""
    return len(text) - text.count("\n") - text.count("\r")


@dataclass(frozen=True)
class BeatSpot:
    """A beat in its chapter: the beats before it, and the one after it (None at the cut)."""

    chapter: chapters_db.ChapterRow
    beat: chapters_db.BeatRow
    before: Sequence[chapters_db.BeatRow]
    after: chapters_db.BeatRow | None
    count: int


def beat_spot(conn: sqlite3.Connection, beat_id: str) -> BeatSpot:
    chapter_id = chapters_db.chapter_of_beat(conn, beat_id)
    chapter = chapters_db.get_chapter(conn, chapter_id) if chapter_id else None
    if chapter is None:
        raise BeatNotFoundError(beat_id)
    beats = chapters_db.beats_of(conn, chapter.id)
    at = next(index for index, beat in enumerate(beats) if beat.id == beat_id)
    after = beats[at + 1] if at + 1 < len(beats) else None
    return BeatSpot(chapter, beats[at], beats[:at], after, len(beats))


def tail(text: str, limit: int) -> str:
    """The end of text within limit chars, from the start of a paragraph, or of a sentence
    when the paragraphs that fit whole are under half the limit."""
    if len(text) <= limit:
        return text
    cut = text[-limit:]
    line = cut.find("\n")
    paragraphs = cut[line:].lstrip("\n") if line != -1 else ""
    if len(paragraphs) >= limit // 2:
        return paragraphs
    end = SENTENCE_END.search(cut)
    return cut[end.end() :] if end else cut


def previous_text(conn: sqlite3.Connection, spot: BeatSpot, begun: str = "") -> str:
    """The manuscript just before the beat (§10): the chapter's written beats before it, or the
    end of the chapter before when the beat opens its chapter. A beat that is being continued
    ends it with what it has so far (begun)."""
    texts = chapters_db.current_texts(conn, spot.chapter.id)
    written = [texts[beat.id] for beat in spot.before if beat.id in texts]
    if begun:
        written.append(begun)
    elif not spot.before:
        earlier = chapters_db.chapter_before(conn, spot.chapter)
        if earlier is not None:
            texts = chapters_db.current_texts(conn, earlier.id)
            written = [
                texts[beat.id]
                for beat in chapters_db.beats_of(conn, earlier.id)
                if beat.id in texts
            ]
    return tail("\n\n".join(text.strip() for text in written), PREVIOUS_CHARS)


def newest_within(items: Sequence[str], limit: int) -> list[str]:
    """The items from the end back that fit in limit chars together, in their order (§10: the
    oldest summaries are dropped first)."""
    kept: list[str] = []
    used = 0
    for item in reversed(items):
        used += len(item)
        if used > limit and kept:
            break
        kept.append(item)
    return kept[::-1]


def character_lines(row: cards_db.CardRow) -> list[str]:
    data = row.data
    personality = data.get("personality") or {}
    speech = data.get("speech") or {}
    examples = [f'"{text}"' for text in (speech.get("examples") or [])[:SPEECH_EXAMPLES]]
    lines = [about("인물", row, data.get("theme"))]
    if personality.get("traits"):
        lines.append(f"  성격: {', '.join(personality['traits'])}")
    lines += [f"  {line}" for line in labelled("말투", speech.get("description"))]
    if examples:
        lines.append(f"  말투 예시: {' / '.join(examples)}")
    lines += [
        f"  {line}" for line in labelled("외모", (data.get("appearance") or {}).get("summary"))
    ]
    return lines


def characters(conn: sqlite3.Connection, ids: Sequence[str], beat_text: str) -> list[str]:
    """The episode's characters, those the beat names first; the others only while they fit."""
    rows = active_cards(conn, ids)
    named = [row for row in rows if row.name and row.name in beat_text]
    lines: list[str] = []
    for row in [*named, *(row for row in rows if row not in named)]:
        found = character_lines(row)
        size = sum(len(line) for line in [*lines, *found])
        if row not in named and lines and size > CHARACTER_CHARS:
            continue
        lines += found
    return lines


def region_lines(row: cards_db.CardRow, label: str, *, sensory: bool) -> list[str]:
    lines = [about(label, row, row.data.get("appearance"))]
    if sensory:
        senses = row.data.get("sensory") or {}
        found = [
            f"{name} {senses[key]}"
            for key, name in (("mood", "분위기"), ("sound", "소리"), ("smell", "냄새"))
            if senses.get(key)
        ]
        if found:
            lines.append(f"  {', '.join(found)}")
    return lines


def world_lines(row: cards_db.CardRow, *, full: bool) -> list[str]:
    category = CATEGORY.get(row.data.get("category") or "", "기타")
    lines = [about(f"세계관({category})", row, row.data.get("summary"))]
    if not full:
        return lines
    for rule in row.data.get("rules") or []:
        exception = f" (예외: {rule['exception']})" if rule.get("exception") else ""
        lines.append(f"  규칙: {rule['rule']}{exception}")
    for term in row.data.get("terms") or []:
        lines.append(f"  용어: {term['term']} = {term['meaning']}")
    return lines


def worlds(conn: sqlite3.Connection, ties: cards_db.EpisodeTies) -> list[str]:
    """The episode's world cards, then those tied to its characters and places (§10), with
    rules and terms while they fit; the rest by summary."""
    tied = [
        *ties.characters,
        *([ties.main_region] if ties.main_region else []),
        *ties.other_regions,
    ]
    ids = [*ties.worlds, *(cards_db.worlds_tied_to(conn, tied) if tied else [])]
    lines: list[str] = []
    for row in active_cards(conn, ids):
        found = world_lines(row, full=True)
        if lines and sum(len(line) for line in [*lines, *found]) > WORLD_CHARS:
            found = world_lines(row, full=False)
        lines += found
    return lines


def card_block(conn: sqlite3.Connection, episode_id: str, beat_text: str) -> str:
    ties = cards_db.episode_ties(conn, episode_id)
    lines = characters(conn, ties.characters, beat_text)
    for row in active_cards(conn, [ties.main_region] if ties.main_region else []):
        lines += region_lines(row, "주 무대", sensory=True)
    for row in active_cards(conn, ties.other_regions):
        lines += region_lines(row, "장소", sensory=False)
    return "\n".join([*lines, *worlds(conn, ties)])


def scene_summary(conn: sqlite3.Connection, spot: BeatSpot) -> str | None:
    record = plans_db.get(conn, spot.chapter.plan_id)
    if record is None:
        return None
    scenes = (scene for chapter in record.plan.chapters for scene in chapter.scenes)
    return next((scene.summary for scene in scenes if scene.scene == spot.beat.scene), None)


def instruction(conn: sqlite3.Connection, spot: BeatSpot, target_chars: int, begun: int = 0) -> str:
    """The beat to write. begun = the chars the beat already has when it is being continued:
    target_chars is then what is still to write."""
    beat = spot.beat
    place = f"{spot.chapter.number}화, 비트 {beat.order}/{spot.count}"
    if not spot.before:
        place += " (화의 첫 비트)"
    if spot.after is None:
        place += " (화의 마지막 비트)"
    lines = [
        f"자리: {place}",
        *labelled("이 비트가 속한 장면", scene_summary(conn, spot)),
        f"시점: {beat.pov}",
        f"서술 방식: {beat.mode}",
        f"초점: {beat.focus}",
        f"묘사량: {beat.density}",
        f"긴장도: {beat.tension} / 5",
        f"분량: 공백 포함 {target_chars}자 안팎",
        f"내용: {beat.summary}",
    ]
    if begun:
        lines.insert(
            -1, f"이어 쓰기: 이 비트는 이미 {begun}자를 썼다. 이미 쓴 원고의 끝에서 이어 쓴다."
        )
    hints = [
        card.prompt_hint
        for card in (techniques_db.get(conn, technique_id) for technique_id in beat.techniques)
        if card is not None and card.prompt_hint
    ]
    if hints:
        lines += ["쓸 기법:", *(f"- {hint}" for hint in hints)]
    if spot.after is None:
        lines.append("다음 비트: 없음 (이 비트에서 화가 끝난다)")
    else:
        lines.append(f"다음 비트(이번에 쓰지 않는다): {spot.after.summary}")
    return "\n".join(lines)


def write_turns(
    conn: sqlite3.Connection,
    style: Style,
    beat_id: str,
    *,
    target_chars: int | None = None,
    summaries: Sequence[str] = (),
    state: Sequence[str] = (),
    begun: str = "",
) -> list[Message]:
    """§10: the beat's matching style sections, the cards, the latest state, the story so far
    (summaries, oldest first, and the manuscript just before the beat), then the beat.
    target_chars replaces the plan's target (adjusted from what the chapter has left). begun =
    the text a beat that came short has so far: the call continues it (the manuscript ends
    with it, target_chars is what is still to write)."""
    spot = beat_spot(conn, beat_id)
    beat = spot.beat
    matched = style.for_beat(
        mode=beat.mode, focus=beat.focus, density=beat.density, pov=beat.pov, tension=beat.tension
    )
    story = newest_within(summaries, SUMMARY_CHARS)
    before = previous_text(conn, spot, begun)
    # A chapter's first beat follows the chapter before: it opens anew, it does not run on.
    if spot.before or begun:
        label, nothing = "이미 쓴 원고의 끝 (다시 쓰지 않고 이 뒤를 잇는다):", "(아직 없음)"
    elif before:
        label, nothing = "앞 화의 끝 (이 비트는 새 화의 첫머리다):", ""
    else:
        label, nothing = "이미 쓴 원고:", "(없음: 작품의 첫머리)"
    source = [
        *(["지금까지의 줄거리:", *story, ""] if story else []),
        label,
        before or nothing,
    ]
    parts = [
        f"이 비트의 문체\n{matched}" if matched else "",
        block("참고 카드", card_block(conn, spot.chapter.episode_id, f"{beat.summary} {beat.pov}")),
        block("상태", "\n".join(state)) if state else "",
        block("원문", "\n".join(source)),
        block(
            "지시",
            instruction(
                conn,
                spot,
                target_chars or beat.target_chars,
                count_chars(begun),
            ),
        ),
    ]
    return [{"role": "user", "content": "\n\n".join(part for part in parts if part)}]
