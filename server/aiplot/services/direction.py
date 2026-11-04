"""Stage 2 direction (§9): the `scene` role splits an episode into scenes, technique candidates
are narrowed in code per scene, and the `pick` role recommends combinations of them.

Each call constrains the model by a schema narrowed to this call's values (the episode's stage
names, the scene's candidate ids); the server cleans the output as well. Nothing is stored yet:
plans and picks get their tables in step 3.
"""

import copy
import sqlite3
from collections.abc import Callable, Collection, Iterable, Sequence
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel

from aiplot.db import techniques as techniques_db
from aiplot.db import works as works_db
from aiplot.generated.card.card import EpisodeCard
from aiplot.generated.roles.pick_output import OutputPick, PickOutput
from aiplot.generated.roles.scene_output import OutputScene, SceneOutput
from aiplot.generated.technique.technique import Technique
from aiplot.llm.client import LlmError, Message, Usage
from aiplot.llm.config import Role
from aiplot.llm.router import OutputMeta, Router
from aiplot.services import cards
from aiplot.services import direction_context as context

# The serial cards `direct` always gets for chapter cuts (§9): 회차 끝 절단, 회차 3단 설계,
# 사이다/고구마 완급, 전회 연결 도입. Never direction candidates.
SERIAL_TECHNIQUES = ("tech_ser_019", "tech_ser_020", "tech_ser_021", "tech_ser_042")

# Scopes a direction candidate works at (§9); 문장 cards are style material, 아크·작품 a later step.
CANDIDATE_SCOPES = frozenset({"장면", "회차"})

CANDIDATE_LIMIT = 20

MAX_PICKS = 3


def is_candidate(card: Technique) -> bool:
    """Scope 장면 or 회차 and not one of the serial cards."""
    return card.id not in SERIAL_TECHNIQUES and not CANDIDATE_SCOPES.isdisjoint(card.scope)


def narrow(
    catalog: Iterable[Technique],
    effects: Collection[str],
    situations: Collection[str],
    limit: int = CANDIDATE_LIMIT,
) -> list[Technique]:
    """A scene's candidates: direction candidates sharing at least one of its tags (effects
    with effects, situations with situations), most shared tags first, ties by more shared
    effects, then id; the first `limit`."""
    wanted_effects = set(effects)
    wanted_situations = set(situations)
    ranked: list[tuple[int, int, str, Technique]] = []
    for card in catalog:
        if not is_candidate(card):
            continue
        shared_effects = len(wanted_effects.intersection(card.effects))
        shared = shared_effects + len(wanted_situations.intersection(card.situations))
        if shared:
            ranked.append((-shared, -shared_effects, card.id, card))
    ranked.sort(key=lambda entry: entry[:3])
    return [entry[3] for entry in ranked[:limit]]


def candidates(
    conn: sqlite3.Connection,
    effects: Collection[str],
    situations: Collection[str],
    limit: int = CANDIDATE_LIMIT,
) -> list[Technique]:
    """`narrow` over the catalog in the database."""
    return narrow(techniques_db.list_all(conn), effects, situations, limit)


def clean_scenes(output: SceneOutput, stage_names: Collection[str]) -> list[OutputScene]:
    """Scenes whose source is one of the episode's structure stage names (§9 `source` =
    episode.stage), in the model's order, numbered 1..n, each tag once."""
    kept = [scene for scene in output.scenes if scene.source in stage_names]
    return [
        scene.model_copy(
            update={
                "scene": number,
                "effects": list(dict.fromkeys(scene.effects)),
                "situations": list(dict.fromkeys(scene.situations)),
            }
        )
        for number, scene in enumerate(kept, start=1)
    ]


def conflicting(techniques: Sequence[Technique]) -> bool:
    """A pair conflicts if either card lists the other in conflicts_with (§9)."""
    return any(
        b.id in a.conflicts_with or a.id in b.conflicts_with
        for i, a in enumerate(techniques)
        for b in techniques[i + 1 :]
    )


def clean_picks(output: PickOutput, scene_candidates: Iterable[Technique]) -> list[OutputPick]:
    """Combinations in the model's rank order, each id once and among the scene's candidates;
    a combination left empty, holding a conflicting pair or repeating an earlier one (same
    cards in any order) is dropped; at most 3, ranks renumbered 1..n."""
    by_id = {card.id: card for card in scene_candidates}
    seen: set[frozenset[str]] = set()
    kept: list[OutputPick] = []
    for pick in sorted(output.picks, key=lambda pick: pick.rank):
        ids = [i for i in dict.fromkeys(pick.techniques) if i in by_id]
        key = frozenset(ids)
        if not ids or key in seen or conflicting([by_id[i] for i in ids]):
            continue
        seen.add(key)
        kept.append(pick.model_copy(update={"rank": len(kept) + 1, "techniques": ids}))
        if len(kept) == MAX_PICKS:
            break
    return kept


# The roles ----------------------------------------------------------------------------------

# Generations when nothing survives cleaning: one more, then LLM_INVALID_OUTPUT (as source, §13).
KEPT_ATTEMPTS = 2


class EpisodeNotReadyError(ValueError):
    """Not an episode, not active (§11: it, its part or the main story incomplete) or without
    structure stages: nothing to direct. Raised before any model call."""


class UnknownStageError(ValueError):
    """A scene whose source is not one of its episode's stage names."""


class NoCandidatesError(ValueError):
    """No direction candidate shares a tag with the scene."""


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
    scenes: list[OutputScene]
    meta: OutputMeta
    usage: Usage | None
    generations: int


@dataclass(frozen=True)
class PickResult:
    candidates: list[Technique]
    picks: list[OutputPick]
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


def pick_schema(candidate_ids: Sequence[str]) -> dict[str, Any]:
    """PickOutput's schema with every technique id limited to the scene's candidates."""
    schema = copy.deepcopy(PickOutput.model_json_schema())
    schema["$defs"]["TechniqueId"] = {"type": "string", "enum": list(candidate_ids)}
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
    """The episode's scenes in story order, each with its source stage and tags (§9)."""
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


async def recommend(
    router: Router, conn: sqlite3.Connection, episode_id: str, scene: OutputScene
) -> PickResult:
    """1-3 recommended combinations for one scene, among its narrowed candidates (§9)."""
    episode = ready_episode(conn, episode_id)
    stage = next((s for s in context.stages_of(episode) if s.name == scene.source), None)
    if stage is None:
        raise UnknownStageError(f"{episode_id} has no stage {scene.source}")
    found = candidates(conn, scene.effects, scene.situations)
    if not found:
        raise NoCandidatesError(f"no candidate shares a tag with scene {scene.scene}")
    kept = await generate_kept(
        router,
        "pick",
        context.pick_turns(episode, stage, scene, found),
        PickOutput,
        pick_schema([card.id for card in found]),
        lambda output: clean_picks(output, found),
    )
    return PickResult(found, kept.items, kept.meta, kept.usage, kept.generations)
