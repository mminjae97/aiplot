"""What the scene role sees (§9, §13): tagged context blocks `<원문> <참고 카드> <지시>`.

The texts here are model input, not UI text: they follow the role prompts in prompts/. Cards
the episode is tied to come from the relation tables (§6); inactive (incomplete) ones are left
out (§11). Technique examples never reach a prompt (§9).
"""

import sqlite3
from collections.abc import Sequence
from typing import Any

from pydantic import BaseModel, ConfigDict

from aiplot.db import cards as cards_db
from aiplot.generated.card.card import EpisodeCard
from aiplot.generated.card.structure import FiveStage, FourStage
from aiplot.generated.technique.technique_device import TechniqueDevice
from aiplot.generated.technique.technique_effect import TechniqueEffect
from aiplot.generated.technique.technique_situation import TechniqueSituation
from aiplot.llm.client import Message
from aiplot.services.draft_context import CATEGORY, block

type Stage = FiveStage | FourStage


class Scene(BaseModel):
    """A cleaned `scene` output scene (§9, direction.clean_scenes): numbered 1..n, the devices
    answered main (`devices`, pre-checked for the user and used for the recommendation) and sub
    (`sub_devices`, listed first among the unchecked), each tag once."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    scene: int
    source: str
    summary: str
    core: str
    devices: list[TechniqueDevice]
    sub_devices: list[TechniqueDevice]
    effects: list[TechniqueEffect]
    situations: list[TechniqueSituation]


def stages_of(episode: EpisodeCard) -> list[Stage]:
    structure = episode.data.structure
    return [] if structure is None else list(structure.stages)


def stage_line(stage: Stage) -> str:
    tension = f" (긴장도 {stage.tension})" if stage.tension is not None else ""
    return f"{stage.name}{tension}: {stage.summary or ''}".rstrip()


def labelled(label: str, value: str | None) -> list[str]:
    return [f"{label}: {value}"] if value else []


def active_cards(conn: sqlite3.Connection, ids: Sequence[str]) -> list[cards_db.CardRow]:
    """The cards among ids that exist and are complete (§11: incomplete ones are inactive)."""
    rows = [cards_db.get(conn, card_id) for card_id in dict.fromkeys(ids)]
    return [row for row in rows if row is not None and row.status == "complete"]


def about(label: str, row: cards_db.CardRow, text: Any) -> str:
    """A card by kind and name with what it is about, without its id: scene writes no ids, and
    one copied into a summary would reach the user."""
    line = f"{label} {row.name}" if row.name else label
    return f"{line}: {text}" if isinstance(text, str) and text else line


def card_lines(conn: sqlite3.Connection, episode: EpisodeCard, ties: cards_db.EpisodeTies) -> str:
    """The main story, the episode's part, characters, places and world cards."""
    placement = cards_db.episode_placement(conn, episode.id)
    main = cards_db.main_story_of(conn, episode.work_id)
    lines: list[str] = []
    for row in active_cards(conn, [main] if main else []):
        lines.append(f"메인 스토리: {row.data.get('theme') or ''}".rstrip())
        lines += [f"  {line}" for line in labelled("전제", row.data.get("premise"))]
    part = placement["part_id"] if placement is not None else None
    for row in active_cards(conn, [part] if part else []):
        title = row.data.get("title") or row.name
        lines.append(f"부 {title}: {row.data.get('theme') or ''}".rstrip())
    for row in active_cards(conn, ties.characters):
        lines.append(about("인물", row, row.data.get("theme")))
        traits = (row.data.get("personality") or {}).get("traits") or []
        if traits:
            lines.append(f"  성격: {', '.join(traits)}")
    for row in active_cards(conn, [ties.main_region] if ties.main_region else []):
        lines.append(about("주 무대", row, row.data.get("appearance")))
    for row in active_cards(conn, ties.other_regions):
        lines.append(about("장소", row, row.data.get("appearance")))
    for row in active_cards(conn, ties.worlds):
        category = CATEGORY.get(row.data.get("category") or "", "기타")
        lines.append(about(f"세계관({category})", row, row.data.get("summary")))
    return "\n".join(lines)


def episode_lines(episode: EpisodeCard, ties: cards_db.EpisodeTies) -> str:
    data = episode.data
    stages = stages_of(episode)
    lines = [
        *labelled("제목", episode.name),
        *labelled("주제", data.theme),
        *labelled("메인 스토리와의 관계", data.relation_to_main),
        *labelled("줄거리", data.synopsis),
        f"구조: {len(stages)}단계",
        *(f"- {stage_line(stage)}" for stage in stages),
    ]
    if ties.plants:
        lines += ["이 에피소드에서 심는 복선:", *(f"- {text}" for _, text in ties.plants)]
    if ties.payoffs:
        lines += ["앞에서 심었고 이 에피소드에서 회수하는 복선:"]
        lines += [f"- {text}" for _, text in ties.payoffs]
    return "\n".join(lines)


def scene_turns(conn: sqlite3.Connection, episode: EpisodeCard) -> list[Message]:
    """§9: the episode, its cards and the stages to split (the tag lists are in the prompt)."""
    names = ", ".join(stage.name for stage in stages_of(episode))
    ties = cards_db.episode_ties(conn, episode.id)
    return [
        {
            "role": "user",
            "content": "\n".join(
                [
                    block("원문", episode_lines(episode, ties)),
                    block("참고 카드", card_lines(conn, episode, ties)),
                    block("지시", f"나눌 단계: {names}"),
                ]
            ),
        }
    ]
