"""Stage 2 direction (§9): the `scene` role's scenes cleaned, technique candidates narrowed in
code per scene, and the `pick` role's recommended combinations cleaned."""

import sqlite3
from collections.abc import Collection, Iterable, Sequence

from aiplot.db import techniques as techniques_db
from aiplot.generated.roles.pick_output import OutputPick, PickOutput
from aiplot.generated.roles.scene_output import OutputScene, SceneOutput
from aiplot.generated.technique.technique import Technique

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
