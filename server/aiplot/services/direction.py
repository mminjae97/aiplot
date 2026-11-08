"""Stage 2 direction (§9): the `scene` role splits an episode into scenes, writes each scene's
core and answers every scene device main, sub or none; code recommends technique cards per scene
from the main devices and tags they share; the `arrange` role places the scenes in chapters.

Each call is constrained by a schema narrowed to the episode (stage names, scene numbers); the
server cleans the output. Recommendations need no model call. Nothing is stored here:
services/plans keeps the plans and picks.
"""

import copy
import math
import sqlite3
from collections.abc import Callable, Collection, Iterable, Sequence
from dataclasses import dataclass, replace
from typing import Any, Literal, cast

from pydantic import BaseModel, ConfigDict

from aiplot.db import techniques as techniques_db
from aiplot.db import works as works_db
from aiplot.generated.card.card import EpisodeCard
from aiplot.generated.direction.plan import (
    DirectionPlan,
    PlanBeat,
    PlanChapter,
    PlanRecommendation,
    PlanScene,
)
from aiplot.generated.roles.arrange_output import ArrangeOutput
from aiplot.generated.roles.direct_output import DirectOutput
from aiplot.generated.roles.scene_output import SceneDevices, SceneOutput
from aiplot.generated.technique.technique import Technique
from aiplot.generated.technique.technique_device import TechniqueDevice
from aiplot.generated.technique.technique_effect import TechniqueEffect
from aiplot.generated.technique.technique_situation import TechniqueSituation
from aiplot.llm.client import LlmError, Message, Usage
from aiplot.llm.config import Role
from aiplot.llm.router import OutputMeta, Router
from aiplot.services import cards
from aiplot.services import direction_context as context
from aiplot.services.direction_context import Place, Scene, SceneSpot

# The serial cards `direct` always gets for chapter cuts (§9): 회차 끝 절단, 회차 3단 설계,
# 사이다/고구마 완급, 전회 연결 도입. Never direction candidates.
SERIAL_TECHNIQUES = ("tech_ser_019", "tech_ser_020", "tech_ser_021", "tech_ser_042")

# Scopes a direction candidate works at (§9); 문장 cards are style material, 아크·작품 a later step.
CANDIDATE_SCOPES = frozenset({"장면", "회차"})

# Cards shown per scene (§9).
RECOMMEND_LIMIT = 5

# Cards the user may choose for a scene (§9).
MAX_CHOSEN = 3

# A scene answering more main devices than this makes the scene output invalid (§9): with yes/no
# answers the 8B sometimes answered all 41 yes for a whole episode (runs 9-10, and a scene v5
# draft with yes/no); main/sub/none answers gave at most 6 main per scene (runs 11-12).
MAX_MAIN_DEVICES = 20


@dataclass(frozen=True)
class Recommendation:
    """A recommended card with what it shares with the scene (the app words the reason)."""

    rank: int
    technique_id: str
    devices: list[TechniqueDevice]
    effects: list[TechniqueEffect]
    situations: list[TechniqueSituation]


def is_candidate(card: Technique) -> bool:
    """Scope 장면 or 회차 and not one of the serial cards."""
    return card.id not in SERIAL_TECHNIQUES and not CANDIDATE_SCOPES.isdisjoint(card.scope)


def rank(
    catalog: Iterable[Technique],
    devices: Collection[str],
    effects: Collection[str],
    situations: Collection[str],
    limit: int = RECOMMEND_LIMIT,
) -> list[Recommendation]:
    """Direction candidates sharing at least one of the scene's devices or tags (effects with
    effects, situations with situations): most shared devices first, ties by more shared tags,
    then id; the first `limit`, ranked 1..n."""
    scored: list[tuple[int, int, str, Recommendation]] = []
    for card in catalog:
        if not is_candidate(card):
            continue
        shared_devices = [d for d in card.devices if d in devices]
        shared_effects = [e for e in card.effects if e in effects]
        shared_situations = [s for s in card.situations if s in situations]
        tags = len(shared_effects) + len(shared_situations)
        if not shared_devices and not tags:
            continue
        found = Recommendation(
            rank=0,
            technique_id=card.id,
            devices=shared_devices,
            effects=shared_effects,
            situations=shared_situations,
        )
        scored.append((-len(shared_devices), -tags, card.id, found))
    scored.sort(key=lambda entry: entry[:3])
    return [replace(entry[3], rank=number) for number, entry in enumerate(scored[:limit], start=1)]


def recommend(conn: sqlite3.Connection, scene: Scene) -> list[Recommendation]:
    """The scene's recommended cards (§9), from the catalog in the database; [] when no
    candidate shares a device or tag."""
    return rank(techniques_db.list_all(conn), scene.devices, scene.effects, scene.situations)


def clean_scenes(output: SceneOutput, stage_names: Collection[str]) -> list[Scene]:
    """Scenes whose source is one of the episode's structure stage names (§9 `source` =
    episode.stage), in the model's order, numbered 1..n; the devices answered main, and those
    answered sub, in the list's order; each tag once. Nothing when any scene answers more than
    MAX_MAIN_DEVICES main."""
    if any(len(answered(scene.devices, "main")) > MAX_MAIN_DEVICES for scene in output.scenes):
        return []
    kept = [scene for scene in output.scenes if scene.source in stage_names]
    return [
        Scene(
            scene=number,
            source=scene.source,
            summary=scene.summary,
            core=scene.core,
            devices=answered(scene.devices, "main"),
            sub_devices=answered(scene.devices, "sub"),
            effects=list(dict.fromkeys(scene.effects)),
            situations=list(dict.fromkeys(scene.situations)),
        )
        for number, scene in enumerate(kept, start=1)
    ]


def answered(devices: SceneDevices, role: Literal["main", "sub"]) -> list[TechniqueDevice]:
    """The devices answered `role`, in the device list's order."""
    keys = [key for key in SceneDevices.model_fields if getattr(devices, key) == role]
    return cast(list[TechniqueDevice], keys)


def choice_error(techniques: Sequence[Technique]) -> str | None:
    """Why the user's cards for a scene are refused (§9, §16), or None: more than MAX_CHOSEN,
    a card that is not a direction candidate, or a conflicting pair. At least one card is the
    request's to require."""
    if len(techniques) > MAX_CHOSEN:
        return "TOO_MANY_TECHNIQUES"
    if not all(is_candidate(card) for card in techniques):
        return "TECHNIQUE_NOT_CANDIDATE"
    if conflicting(techniques):
        return "TECHNIQUES_CONFLICT"
    return None


def conflicting(techniques: Sequence[Technique]) -> bool:
    """A pair conflicts if either card lists the other in conflicts_with (§9)."""
    return any(
        b.id in a.conflicts_with or a.id in b.conflicts_with
        for i, a in enumerate(techniques)
        for b in techniques[i + 1 :]
    )


# The roles ----------------------------------------------------------------------------------

# Generations when nothing survives cleaning: one more, then LLM_INVALID_OUTPUT (as source, §13).
KEPT_ATTEMPTS = 2


class EpisodeNotReadyError(ValueError):
    """Not an episode, not active (§11: it, its part or the main story incomplete) or without
    structure stages: nothing to direct. Raised before any model call."""


@dataclass(frozen=True)
class Kept[K]:
    """A role's cleaned output. usage is the kept generation's (llama.cpp counts the whole
    prompt in prompt_tokens, cached part included); generations counts every model call made,
    the router's retries after an invalid or cut-off reply included."""

    items: list[K]
    meta: OutputMeta
    usage: Usage | None
    generations: int


@dataclass(frozen=True)
class SceneResult:
    scenes: list[Scene]
    meta: OutputMeta
    usage: Usage | None
    generations: int


def ready_episode(conn: sqlite3.Connection, episode_id: str) -> EpisodeCard:
    card = cards.get(conn, episode_id)
    if card is None:
        raise cards.CardNotFoundError(episode_id)
    if not isinstance(card, EpisodeCard):
        raise EpisodeNotReadyError(f"{episode_id} is not an episode")
    if not works_db.is_active_episode(conn, episode_id):
        raise EpisodeNotReadyError(f"{episode_id} is inactive (it, its part or the story)")
    # A guard only: a complete episode always has stages with summaries (§15).
    if not context.stages_of(card):
        raise EpisodeNotReadyError(f"{episode_id} has no structure stages")
    return card


def scene_schema(stage_names: Sequence[str]) -> dict[str, Any]:
    """SceneOutput's schema with source limited to the episode's stage names."""
    schema = copy.deepcopy(SceneOutput.model_json_schema())
    schema["$defs"]["OutputScene"]["properties"]["source"] = {
        "type": "string",
        "enum": list(stage_names),
    }
    return schema


async def generate_kept[T: BaseModel, K](
    router: Router,
    role: Role,
    turns: list[Message],
    output: type[T],
    schema: dict[str, Any],
    clean: Callable[[T], list[K]],
) -> Kept[K]:
    """The cleaned output; when cleaning leaves nothing, one more generation, then an error."""
    generations = 0
    for _ in range(KEPT_ATTEMPTS):
        result = await router.complete_json(role, turns, output, schema)
        generations += result.attempts
        kept = clean(result.value)
        if kept:
            return Kept(kept, result.meta, result.usage, generations)
    raise LlmError("LLM_INVALID_OUTPUT", f"{role}: nothing left after cleaning")


async def split_scenes(router: Router, conn: sqlite3.Connection, episode_id: str) -> SceneResult:
    """The episode's scenes in story order, each with its source stage, devices and tags (§9)."""
    episode = ready_episode(conn, episode_id)
    names = [stage.name for stage in context.stages_of(episode)]
    kept = await generate_kept(
        router,
        "scene",
        context.scene_turns(conn, episode),
        SceneOutput,
        scene_schema(names),
        lambda output: clean_scenes(output, names),
    )
    return SceneResult(kept.items, kept.meta, kept.usage, kept.generations)


# arrange ------------------------------------------------------------------------------------

# A chapter's target in characters incl. spaces (§1, §10); arrange's scene targets are rescaled
# to sum to it.
CHAPTER_CHARS = 5500


class ArrangedScene(BaseModel):
    """A scene placed in a chapter: its story-order number, its target in characters (rescaled)
    and what it reveals to the reader."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    scene: int
    target_chars: int
    reveal: list[str]


class ArrangedChapter(BaseModel):
    """A chapter numbered 1..n, its scenes in narration order (cut after the last)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    chapter: int
    target_chars: int
    scenes: list[ArrangedScene]


@dataclass(frozen=True)
class ArrangeResult:
    chapters: list[ArrangedChapter]
    meta: OutputMeta
    usage: Usage | None
    generations: int


def rescale(weights: Sequence[int], total: int) -> list[int]:
    """Shares of total in proportion to weights (each > 0), summing to total exactly: one each
    first, the rest by largest remainder (ties to the earlier). Needs total >= len(weights)."""
    if total < len(weights):
        raise ValueError(f"total {total} below {len(weights)} shares")
    rest = total - len(weights)
    whole = sum(weights)
    exact = [rest * weight / whole for weight in weights]
    shares = [int(value) for value in exact]
    by_remainder = sorted(range(len(weights)), key=lambda i: (shares[i] - exact[i], i))
    for i in by_remainder[: rest - sum(shares)]:
        shares[i] += 1
    return [share + 1 for share in shares]


def clean_reveal(texts: Iterable[str]) -> list[str]:
    """Each text stripped, once, empty ones dropped."""
    return list(dict.fromkeys(text.strip() for text in texts if text.strip()))


def clean_arrangement(output: ArrangeOutput, count: int) -> list[ArrangedChapter]:
    """Chapters numbered 1..n, each scene's target rescaled so a chapter's sum to CHAPTER_CHARS,
    reveals cleaned. Nothing unless every scene 1..count appears exactly once (§9)."""
    numbers = [scene.scene for chapter in output.chapters for scene in chapter.scenes]
    if sorted(numbers) != list(range(1, count + 1)):
        return []
    chapters: list[ArrangedChapter] = []
    for number, chapter in enumerate(output.chapters, start=1):
        targets = rescale([scene.target_chars for scene in chapter.scenes], CHAPTER_CHARS)
        scenes = [
            ArrangedScene(scene=scene.scene, target_chars=target, reveal=clean_reveal(scene.reveal))
            for scene, target in zip(chapter.scenes, targets, strict=True)
        ]
        chapters.append(ArrangedChapter(chapter=number, target_chars=CHAPTER_CHARS, scenes=scenes))
    return chapters


def arrange_schema(count: int) -> dict[str, Any]:
    """ArrangeOutput's schema with scene numbers limited to 1..count."""
    schema = copy.deepcopy(ArrangeOutput.model_json_schema())
    number = schema["$defs"]["ArrangeScene"]["properties"]["scene"]
    number["maximum"] = count
    return schema


async def arrange_scenes(
    router: Router, conn: sqlite3.Connection, episode_id: str, scenes: Sequence[Scene]
) -> ArrangeResult:
    """The episode's scenes (numbered 1..n in story order, as split_scenes gives them) in
    chapters: narration order, cuts between scenes, scene targets and reveals (§9)."""
    episode = ready_episode(conn, episode_id)
    if not scenes or [scene.scene for scene in scenes] != list(range(1, len(scenes) + 1)):
        raise ValueError("scenes must be numbered 1..n in story order, at least one")
    count = len(scenes)
    kept = await generate_kept(
        router,
        "arrange",
        context.arrange_turns(episode, scenes),
        ArrangeOutput,
        arrange_schema(count),
        lambda output: clean_arrangement(output, count),
    )
    return ArrangeResult(kept.items, kept.meta, kept.usage, kept.generations)


def build_plan(
    conn: sqlite3.Connection,
    episode_id: str,
    scenes: Sequence[Scene],
    chapters: Sequence[ArrangedChapter],
) -> DirectionPlan:
    """A new plan from the scene and arrange outputs: every scene undirected, its devices the
    AI's main answers until the user corrects them, its recommendations from those (§9)."""
    by_number = {scene.scene: scene for scene in scenes}
    return DirectionPlan(
        episode=episode_id,
        chapters=[
            PlanChapter(
                chapter=chapter.chapter,
                target_chars=chapter.target_chars,
                scenes=[
                    plan_scene(conn, by_number[placed.scene], placed) for placed in chapter.scenes
                ],
            )
            for chapter in chapters
        ],
    )


def plan_scene(conn: sqlite3.Connection, scene: Scene, placed: ArrangedScene) -> PlanScene:
    return PlanScene(
        scene=scene.scene,
        status="undirected",
        source=scene.source,
        summary=scene.summary,
        core=scene.core,
        target_chars=placed.target_chars,
        ai_devices=list(scene.devices),
        sub_devices=list(scene.sub_devices),
        devices=list(scene.devices),
        effects=list(scene.effects),
        situations=list(scene.situations),
        recommended=[
            PlanRecommendation(
                rank=found.rank,
                technique=found.technique_id,
                devices=found.devices,
                effects=found.effects,
                situations=found.situations,
            )
            for found in recommend(conn, scene)
        ],
        chosen=[],
        reveal=list(placed.reveal),
        beats=[],
    )


# direct -------------------------------------------------------------------------------------

# Serial cards by a scene's place in its chapter (§9): 전회 연결 도입 opens a chapter, 회차 끝
# 절단 ends it, 회차 3단 설계 and 사이다/고구마 완급 go with every scene.
OPENING_SERIAL = "tech_ser_042"
CUT_SERIAL = "tech_ser_019"
EVERY_SERIAL = ("tech_ser_020", "tech_ser_021")

# A beat's size in characters incl. spaces (§1); bounds a scene's beat count.
BEAT_CHARS = (500, 1000)


@dataclass(frozen=True)
class DirectResult:
    beats: list[PlanBeat]
    meta: OutputMeta
    usage: Usage | None
    generations: int


class SceneNotReadyError(ValueError):
    """The scene cannot be directed: not in the plan, or its chosen cards are refused (no card,
    an unknown one, or choice_error's code). Raised before any model call."""


def serial_for(place: Place) -> list[str]:
    opening = [OPENING_SERIAL] if place in ("first", "only") else []
    cut = [CUT_SERIAL] if place in ("last", "only") else []
    return [*opening, *EVERY_SERIAL, *cut]


def place_of(index: int, size: int) -> Place:
    if size == 1:
        return "only"
    if index == 0:
        return "first"
    return "last" if index == size - 1 else "middle"


def locate(plan: DirectionPlan, number: int) -> SceneSpot:
    """The scene with its chapter, place and narration-order neighbours (across chapters)."""
    flat = [
        (chapter.chapter, place_of(index, len(chapter.scenes)), scene)
        for chapter in plan.chapters
        for index, scene in enumerate(chapter.scenes)
    ]
    for position, (chapter, place, scene) in enumerate(flat):
        if scene.scene == number:
            previous = flat[position - 1][2] if position > 0 else None
            following = flat[position + 1][2] if position + 1 < len(flat) else None
            return SceneSpot(chapter, place, scene, previous, following)
    raise SceneNotReadyError(f"scene {number} is not in the plan")


def beat_range(target_chars: int) -> tuple[int, int]:
    """How many beats of BEAT_CHARS fit the scene: at least one."""
    low_chars, high_chars = BEAT_CHARS
    low = max(1, math.ceil(target_chars / high_chars))
    return low, max(low, target_chars // low_chars)


def direct_schema(technique_ids: Sequence[str], beats: tuple[int, int]) -> dict[str, Any]:
    """DirectOutput's schema with techniques limited to the scene's cards and the beat count to
    the scene's range."""
    schema = copy.deepcopy(DirectOutput.model_json_schema())
    properties = schema["$defs"]["DirectBeat"]["properties"]
    properties["techniques"]["items"] = {"type": "string", "enum": list(technique_ids)}
    schema["properties"]["beats"]["minItems"], schema["properties"]["beats"]["maxItems"] = beats
    return schema


def clean_beats(
    output: DirectOutput, target_chars: int, allowed: Collection[str]
) -> list[PlanBeat]:
    """Beats numbered 1..n, targets rescaled to the scene's, summaries stripped, each allowed
    technique once. Nothing if a summary or pov is blank, or with more beats than characters
    (the schema's beat count rules that out)."""
    if len(output.beats) > target_chars:
        return []
    if any(not (beat.summary.strip() and beat.pov.strip()) for beat in output.beats):
        return []
    targets = rescale([beat.target_chars for beat in output.beats], target_chars)
    return [
        PlanBeat(
            order=order,
            summary=beat.summary.strip(),
            techniques=list(dict.fromkeys(t for t in beat.techniques if t in allowed)),
            pov=beat.pov.strip(),
            mode=beat.mode,
            focus=beat.focus,
            density=beat.density,
            tension=beat.tension,
            target_chars=target,
        )
        for order, (beat, target) in enumerate(zip(output.beats, targets, strict=True), start=1)
    ]


def chosen_cards(conn: sqlite3.Connection, scene: PlanScene) -> list[Technique]:
    if not scene.chosen:
        raise SceneNotReadyError(f"scene {scene.scene} has no chosen card")
    found = [techniques_db.get(conn, technique_id) for technique_id in scene.chosen]
    cards_found = [card for card in found if card is not None]
    if len(cards_found) < len(found):
        raise SceneNotReadyError(f"scene {scene.scene} has an unknown card")
    error = choice_error(cards_found)
    if error is not None:
        raise SceneNotReadyError(error)
    return cards_found


@dataclass(frozen=True)
class DirectCall:
    """What a direct call sends and cleans against: the turns, the narrowed schema, the ids the
    beats may name and the scene's target."""

    turns: list[Message]
    schema: dict[str, Any]
    allowed: list[str]
    target_chars: int


def prepare_direct(conn: sqlite3.Connection, plan: DirectionPlan, number: int) -> DirectCall:
    """The direct call for one scene, after the checks made before any model call."""
    episode = ready_episode(conn, plan.episode)
    spot = locate(plan, number)
    chosen = chosen_cards(conn, spot.scene)
    serial = [techniques_db.get(conn, technique_id) for technique_id in serial_for(spot.place)]
    serial_cards = [card for card in serial if card is not None]
    allowed = [card.id for card in [*chosen, *serial_cards]]
    beats = beat_range(spot.scene.target_chars)
    return DirectCall(
        turns=context.direct_turns(conn, episode, spot, chosen, serial_cards, beats),
        schema=direct_schema(allowed, beats),
        allowed=allowed,
        target_chars=spot.scene.target_chars,
    )


async def direct_scene(
    router: Router, conn: sqlite3.Connection, plan: DirectionPlan, number: int
) -> DirectResult:
    """One scene's beats (§9): the scene in its episode with its place, neighbours, the user's
    1-3 cards and the serial cards for its place."""
    call = prepare_direct(conn, plan, number)
    kept = await generate_kept(
        router,
        "direct",
        call.turns,
        DirectOutput,
        call.schema,
        lambda output: clean_beats(output, call.target_chars, call.allowed),
    )
    return DirectResult(kept.items, kept.meta, kept.usage, kept.generations)
