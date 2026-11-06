"""Stage 2 direction (§9): the `scene` role splits an episode into scenes, writes each scene's
core and answers every scene device main, sub or none; code recommends technique cards per scene
from the main devices and tags they share.

The scene call is constrained by a schema narrowed to the episode's stage names; the server
cleans its output. Recommendations need no model call. Nothing is stored yet: plans and picks
get their tables in step 3.
"""

import copy
import sqlite3
from collections.abc import Callable, Collection, Iterable, Sequence
from dataclasses import dataclass, replace
from typing import Any, Literal, cast

from pydantic import BaseModel

from aiplot.db import techniques as techniques_db
from aiplot.db import works as works_db
from aiplot.generated.card.card import EpisodeCard
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
from aiplot.services.direction_context import Scene

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
# answers the 8B sometimes answered all 41 yes for a whole episode (runs 9-10, 11); main/sub/none
# answers gave at most 6 main per scene in the device experiment.
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
