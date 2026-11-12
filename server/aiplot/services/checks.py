"""Checks of a written beat (§7, §10): after a beat is stored the check role reads it against
the cards and the state before it, and gives what the beat changed in its characters' state and
where it contradicts them. The server keeps the state as records of the beat and the
contradictions as warnings on the beat's version.

The model names cards, never ids (§10): names are mapped to the cards it was shown, unknown ones
dropped. A check that fails twice leaves a `check_failed` warning and the job goes on.

The texts here are model input, not UI text: they follow prompts/check.
"""

import copy
import secrets
import sqlite3
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from aiplot.db import cards as cards_db
from aiplot.db import chapters as chapters_db
from aiplot.db import checks as checks_db
from aiplot.db.checks import StateRow
from aiplot.db.connection import transaction
from aiplot.generated.roles.check_output import (
    AppearanceChange,
    CheckOutput,
    InjuryChange,
    ItemChange,
    LocationChange,
    RelationChange,
    SecretChange,
    StateChange,
)
from aiplot.generated.writing.warning import Warning
from aiplot.jobs.queue import JobContext
from aiplot.llm.client import LlmError, Message
from aiplot.llm.router import Router
from aiplot.services import works, write_context
from aiplot.services.direction_context import about, active_cards, labelled
from aiplot.services.draft_context import block
from aiplot.services.notes import split_sentences
from aiplot.services.write_context import BeatNotFoundError, BeatSpot, beat_spot

WRITING_STAGE = 3
# §10: the latest state is ~200 tokens of a beat's context (a draft, in chars).
STATE_CHARS = 500
# Ignored warnings a later check is told of, newest first.
IGNORED = 8
# A check that failed for one of these leaves a warning; anything else fails the job.
SKIPPED = ("LLM_INVALID_OUTPUT", "LLM_OUTPUT_TRUNCATED")
UNIT = {"minute": "분", "hour": "시간", "day": "일"}
CHANGES = (
    "LocationChange",
    "InjuryChange",
    "ItemChange",
    "SecretChange",
    "RelationChange",
    "AppearanceChange",
)


class ChapterNotFoundError(LookupError):
    pass


class WarningNotFoundError(LookupError):
    pass


@dataclass(frozen=True)
class Cast:
    """The cards a check is shown, by name: the episode's characters (whose state is kept), the
    work's regions (where they can be) and every card a warning can be judged against."""

    characters: dict[str, str] = field(default_factory=dict)
    regions: dict[str, str] = field(default_factory=dict)
    evidence: dict[str, str] = field(default_factory=dict)


def cast_of(conn: sqlite3.Connection, spot: BeatSpot) -> Cast:
    ties = cards_db.episode_ties(conn, spot.chapter.episode_id)
    characters = {row.name: row.id for row in active_cards(conn, ties.characters) if row.name}
    regions = {
        row.name: row.id
        for row in cards_db.list_for_work(conn, spot.chapter.work_id, "region")
        if row.name and row.status == "complete"
    }
    tied = [*ties.characters, *([ties.main_region] if ties.main_region else [])]
    world_ids = [*ties.worlds, *cards_db.worlds_tied_to(conn, [*tied, *ties.other_regions])]
    worlds = {row.name: row.id for row in active_cards(conn, world_ids) if row.name}
    # A name two cards share is the character's, then the region's.
    return Cast(characters, regions, {**worlds, **regions, **characters})


# state ------------------------------------------------------------------------------------------


def subject(key: str, value: dict[str, Any]) -> str:
    """What a record is about besides its character and key (§7): the latest per subject is
    the state."""
    name = {"item": "name", "knows_secret": "secret", "injury": "part"}.get(key)
    if key == "relation_change":
        return str(value["target_id"])
    return " ".join(str(value[name]).split()) if name else ""


def latest(rows: Sequence[StateRow]) -> dict[tuple[str, str, str], dict[str, Any]]:
    """The latest record per character, key and subject, in the order they were last set."""
    found: dict[tuple[str, str, str], dict[str, Any]] = {}
    for row in rows:
        at = (row.card_id, row.key, subject(row.key, row.value))
        found.pop(at, None)
        found[at] = row.value
    return found


def held(key: str, value: dict[str, Any]) -> bool:
    """Whether the record still tells of the character: a lost item and a healed injury do not."""
    return not (
        (key == "item" and value["action"] == "lose") or (key == "injury" and value["healed"])
    )


def state_before(conn: sqlite3.Connection, spot: BeatSpot) -> list[StateRow]:
    chapter = spot.chapter
    return checks_db.state_before(
        conn, chapter.work_id, chapter.number, chapter.id, spot.beat.order
    )


def state_line(key: str, value: dict[str, Any], name: str, names: dict[str, str]) -> str | None:
    if key == "location":
        place = names.get(value["region_id"])
        return f"{name}: 지금 있는 곳은 {place}" if place else None
    if key == "injury":
        return f"{name}: {value['part']} 부상 ({value['severity']}, {value['since_chapter']}화부터)"
    if key == "item":
        return f"{name}: {value['name']}을(를) 가지고 있다"
    if key == "knows_secret":
        return f"{name}: 아는 비밀 ({value['since_chapter']}화부터): {value['secret']}"
    if key == "relation_change":
        other = names.get(value["target_id"])
        return f"{name}: {other}과(와)의 사이: {value['change']}" if other else None
    return f"{name}: 달라진 외모: {value['text']}"


def state_lines(conn: sqlite3.Connection, spot: BeatSpot, cast: Cast) -> list[str]:
    """The latest state before the beat as lines, in the order it was last set; only of the
    cards the beat's episode shows (§11: inactive ones are left out)."""
    names = {card_id: name for name, card_id in cast.evidence.items()}
    characters = {card_id: name for name, card_id in cast.characters.items()}
    lines = []
    for (card_id, key, _), value in latest(state_before(conn, spot)).items():
        name = characters.get(card_id)
        line = state_line(key, value, name, names) if name and held(key, value) else None
        if line:
            lines.append(line)
    return lines


def state_for_beat(conn: sqlite3.Connection, beat_id: str) -> list[str]:
    """What the write role is told of the state before the beat (§10): the newest that fit."""
    spot = beat_spot(conn, beat_id)
    lines = state_lines(conn, spot, cast_of(conn, spot))
    return write_context.newest_within(lines, STATE_CHARS)


# context ----------------------------------------------------------------------------------------


def character_lines(row: cards_db.CardRow) -> list[str]:
    """A character as the checks need it: how it acts and looks (§7)."""
    data = row.data
    personality = data.get("personality") or {}
    appearance = data.get("appearance") or {}
    lines = [about("인물", row, data.get("theme"))]
    if personality.get("traits"):
        lines.append(f"  성격: {', '.join(personality['traits'])}")
    for behavior in personality.get("behaviors") or []:
        lines.append(f"  행동: {behavior['situation']} → {behavior['action']}")
    lines += [f"  {line}" for line in labelled("외모", appearance.get("summary"))]
    lines += [f"  {line}" for line in labelled("외모 상세", appearance.get("details"))]
    return lines


def travel_lines(conn: sqlite3.Connection, work_id: str, cast: Cast) -> list[str]:
    """How long it takes between the work's regions (the evidence for impossible travel)."""
    names = {card_id: name for name, card_id in cast.regions.items()}
    lines = []
    for row in cards_db.region_links_of_work(conn, work_id):
        if row["from_id"] not in names or row["to_id"] not in names:
            continue
        if row["travel_value"] is None or row["travel_unit"] is None:
            continue
        mode = f" ({row['travel_mode']})" if row["travel_mode"] else ""
        time = f"{row['travel_value']:g}{UNIT[row['travel_unit']]}"
        lines.append(f"이동: {names[row['from_id']]} → {names[row['to_id']]} {time}{mode}")
    return lines


def card_block(conn: sqlite3.Connection, spot: BeatSpot, cast: Cast) -> str:
    ties = cards_db.episode_ties(conn, spot.chapter.episode_id)
    lines: list[str] = []
    for row in active_cards(conn, ties.characters):
        lines += character_lines(row)
    shown = [*([ties.main_region] if ties.main_region else []), *ties.other_regions]
    for row in active_cards(conn, shown):
        lines.append(about("장소", row, row.data.get("appearance")))
    others = [name for name, card_id in cast.regions.items() if card_id not in shown]
    if others:
        lines.append(f"다른 지역: {', '.join(others)}")
    lines += travel_lines(conn, spot.chapter.work_id, cast)
    return "\n".join([*lines, *write_context.worlds(conn, ties)])


def check_turns(
    conn: sqlite3.Connection, spot: BeatSpot, cast: Cast, sentences: Sequence[str]
) -> list[Message]:
    """§10: the cards, the state before the beat, the beat's text as numbered sentences, then
    where the beat is and what the user chose to ignore."""
    state = state_lines(conn, spot, cast)
    text = "\n".join(f"[{number}] {sentence}" for number, sentence in enumerate(sentences, 1))
    order = [f"자리: {spot.chapter.number}화, 비트 {spot.beat.order}/{spot.count}"]
    ignored = checks_db.ignored_reasons(conn, spot.chapter.work_id, IGNORED)
    if ignored:
        order.append("사용자가 무시한 경고 (같은 까닭으로 다시 경고하지 않는다):")
        order += [f"- {reason} → 무시한 까닭: {why}" for reason, why in ignored]
    parts = [
        block("참고 카드", card_block(conn, spot, cast)),
        block("상태", "\n".join(state) if state else "(기록 없음)"),
        block("원문", text),
        block("지시", "\n".join(order)),
    ]
    return [{"role": "user", "content": "\n\n".join(parts)}]


def check_schema(cast: Cast, sentences: int) -> dict[str, Any]:
    """CheckOutput narrowed to this call: the names it may give and the sentences there are."""
    schema = copy.deepcopy(CheckOutput.model_json_schema())
    defs = schema["$defs"]
    characters = list(cast.characters)
    kept = [
        name
        for name in CHANGES
        if characters
        and not (name == "LocationChange" and not cast.regions)
        and not (name == "RelationChange" and len(characters) < 2)
    ]
    for name in kept:
        defs[name]["properties"]["card"] = {"type": "string", "enum": characters}
    if "LocationChange" in kept:
        defs["LocationChange"]["properties"]["region"] = {
            "type": "string",
            "enum": list(cast.regions),
        }
    if "RelationChange" in kept:
        defs["RelationChange"]["properties"]["target"] = {"type": "string", "enum": characters}
    defs["StateChange"] = {"anyOf": [{"$ref": f"#/$defs/{name}"} for name in kept]}
    if not kept:
        schema["properties"]["state"] = {"type": "array", "maxItems": 0}
    warning = defs["CheckWarning"]["properties"]
    warning["sentence"] = {"type": "integer", "minimum": 1, "maximum": max(sentences, 1)}
    warning["card"] = {"anyOf": [{"type": "string", "enum": list(cast.evidence)}, {"type": "null"}]}
    if not cast.evidence:
        warning["card"] = {"type": "null"}
    return schema


# cleaning ---------------------------------------------------------------------------------------


def tidy(text: str) -> str:
    return " ".join(text.split())


def value_of(
    change: StateChange, card_id: str, cast: Cast, number: int, before: dict[Any, dict[str, Any]]
) -> tuple[str, dict[str, Any]] | None:
    """The record's key and value for a change (§7), None for one that names an unknown card
    or says nothing. number = the beat's chapter: what a new injury or secret dates from."""
    if isinstance(change, LocationChange):
        region = cast.regions.get(change.region)
        return ("location", {"region_id": region}) if region else None
    if isinstance(change, InjuryChange):
        part = tidy(change.part)
        known = before.get((card_id, "injury", part))
        since = known["since_chapter"] if known and not known["healed"] else number
        value = {
            "part": part,
            "severity": change.severity,
            "since_chapter": since,
            "healed": change.healed,
        }
        return ("injury", value) if part else None
    if isinstance(change, ItemChange):
        name = tidy(change.name)
        return ("item", {"name": name, "action": change.action}) if name else None
    if isinstance(change, SecretChange):
        secret = tidy(change.secret)
        if not secret or (card_id, "knows_secret", secret) in before:
            return None
        return "knows_secret", {"secret": secret, "since_chapter": number}
    if isinstance(change, RelationChange):
        target = cast.characters.get(change.target)
        text = tidy(change.change)
        if not target or target == card_id or not text:
            return None
        return "relation_change", {"target_id": target, "change": text}
    assert isinstance(change, AppearanceChange)
    text = tidy(change.text)
    return ("appearance_change", {"text": text}) if text else None


def clean_state(
    output: CheckOutput, cast: Cast, number: int, before: Sequence[StateRow]
) -> list[StateRow]:
    """The beat's state records: changes of unknown cards dropped, a subject said twice kept as
    it was said last, and what the state before the beat already holds left out."""
    known = latest(before)
    found: dict[tuple[str, str, str], dict[str, Any]] = {}
    for change in output.state:
        card_id = cast.characters.get(change.card)
        made = value_of(change, card_id, cast, number, known) if card_id else None
        if card_id is None or made is None:
            continue
        key, value = made
        at = (card_id, key, subject(key, value))
        found.pop(at, None)
        if known.get(at) != value:
            found[at] = value
    return [StateRow(card_id, key, value) for (card_id, key, _), value in found.items()]


@dataclass(frozen=True)
class Found:
    """A warning to store: kind, the sentence's number, the evidence card, the reason."""

    kind: str
    sentence: int | None
    card_id: str | None
    reason: str


def clean_warnings(output: CheckOutput, cast: Cast, sentences: int) -> list[Found]:
    """The check's warnings: a sentence number out of range and an unknown card become none,
    one without a reason and one said twice are dropped."""
    found: dict[tuple[str, int | None, str | None], Found] = {}
    for warning in output.warnings:
        reason = tidy(warning.reason)
        sentence = warning.sentence if warning.sentence <= sentences else None
        card_id = cast.evidence.get(warning.card) if warning.card else None
        if reason:
            found.setdefault(
                (warning.kind, sentence, card_id), Found(warning.kind, sentence, card_id, reason)
            )
    return list(found.values())


# the check --------------------------------------------------------------------------------------


def store(
    conn: sqlite3.Connection,
    work_id: str,
    beat_id: str,
    version: int,
    state: Sequence[StateRow],
    warnings: Sequence[Found],
) -> list[str]:
    """The beat's state records and the warnings on its version, in one transaction (the
    warnings' ids); the stage may have been reopened while the role read."""
    ids = [f"wr_{secrets.token_hex(8)}" for _ in warnings]
    with transaction(conn):
        works.require_current(conn, work_id, WRITING_STAGE)
        row = checks_db.version_id(conn, beat_id, version)
        if row is None:
            raise BeatNotFoundError(beat_id)
        checks_db.replace_state(conn, beat_id, state)
        for warning_id, warning in zip(ids, warnings, strict=True):
            checks_db.insert_warning(
                conn,
                warning_id,
                row,
                warning.card_id,
                warning.kind,
                warning.sentence,
                warning.reason,
            )
    return ids


async def check_beat(
    router: Router,
    conn: sqlite3.Connection,
    ctx: JobContext,
    work_id: str,
    beat_id: str,
    version: int,
    text: str,
    banned: Sequence[str] = (),
) -> int:
    """Checks the beat's stored version (§10) and gives the number of warnings on it: its state
    records replace the beat's, the check's warnings and one per banned phrase kept in the text
    are stored on the version. A check that came back invalid or cut off twice leaves a
    check_failed warning in their place, and no state."""
    spot = beat_spot(conn, beat_id)
    cast = cast_of(conn, spot)
    sentences = split_sentences(text)
    # A pattern is only checked, never shown (§10): its warning has no reason.
    found = [
        Found("banned_phrase", None, None, "" if phrase.startswith("/") else phrase)
        for phrase in banned
    ]
    state: list[StateRow] = []
    try:
        result = await router.complete_json(
            "check",
            check_turns(conn, spot, cast, sentences),
            CheckOutput,
            check_schema(cast, len(sentences)),
        )
    except LlmError as exc:
        if exc.code not in SKIPPED:
            raise
        found.append(Found("check_failed", None, None, exc.code))
    else:
        state = clean_state(result.value, cast, spot.chapter.number, state_before(conn, spot))
        found += clean_warnings(result.value, cast, len(sentences))
    ids = store(conn, work_id, beat_id, version, state, found)
    for record in state:
        ctx.emit(
            "state_update", {"cardId": record.card_id, "key": record.key, "value": record.value}
        )
    for warning_id, warning in zip(ids, found, strict=True):
        ctx.emit("warning", {"warningId": warning_id, "beatId": beat_id, "kind": warning.kind})
    ctx.emit("beat_checked", {"beatId": beat_id, "warnings": len(found)})
    return len(found)


# warnings (§16) ---------------------------------------------------------------------------------


def chapter_warnings(conn: sqlite3.Connection, chapter_id: str) -> list[Warning]:
    if chapters_db.get_chapter(conn, chapter_id) is None:
        raise ChapterNotFoundError(chapter_id)
    return checks_db.warnings_of_chapter(conn, chapter_id)


def update_warning(
    conn: sqlite3.Connection, warning_id: str, status: str, reason: str | None
) -> Warning:
    """무시 with the user's reason, or the warning opened again (its reason dropped); only while
    writing is the current stage."""
    with transaction(conn):
        warning = checks_db.get_warning(conn, warning_id)
        chapter_id = chapters_db.chapter_of_beat(conn, warning.beat_id) if warning else None
        chapter = chapters_db.get_chapter(conn, chapter_id) if chapter_id else None
        if chapter is None:
            raise WarningNotFoundError(warning_id)
        works.require_current(conn, chapter.work_id, WRITING_STAGE)
        why = tidy(reason or "") or None
        checks_db.set_warning_status(conn, warning_id, status, why if status == "ignored" else None)
    updated = checks_db.get_warning(conn, warning_id)
    assert updated is not None
    return updated
