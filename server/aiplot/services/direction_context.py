"""What the direction roles see (§9, §13): tagged blocks `<원문> <참고 카드> <지시>`.

The texts here are model input, not UI text: they follow the role prompts in prompts/. Cards
the episode is tied to come from the relation tables (§6); inactive (incomplete) ones are left
out (§11). Technique examples never reach a prompt (§9).
"""

import sqlite3
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from aiplot.db import cards as cards_db
from aiplot.generated.card.card import EpisodeCard
from aiplot.generated.card.structure import FiveStage, FourStage
from aiplot.generated.direction.plan import PlanBeat, PlanScene
from aiplot.generated.technique.technique import Technique
from aiplot.generated.technique.technique_device import TechniqueDevice
from aiplot.generated.technique.technique_effect import TechniqueEffect
from aiplot.generated.technique.technique_situation import TechniqueSituation
from aiplot.llm.client import Message
from aiplot.services.draft_context import CATEGORY, block

type Stage = FiveStage | FourStage

# Where a scene sits in its chapter (§9): the serial cards it gets follow from it.
type Place = Literal["first", "middle", "last", "only"]

PLACE_TEXT: dict[Place, str] = {
    "first": "첫 장면",
    "middle": "중간 장면",
    "last": "마지막 장면 (이 장면 뒤에서 화가 끝난다)",
    "only": "하나뿐인 장면 (이 장면으로 화가 시작하고 끝난다)",
}


@dataclass(frozen=True)
class SceneSpot:
    """A plan scene with its place: its chapter, where in it, and the scenes just before and
    after it in narration order (across chapters; None at the episode's ends)."""

    chapter: int
    place: Place
    scene: PlanScene
    previous: PlanScene | None
    next: PlanScene | None


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


def stage_label(episode: EpisodeCard, source: str) -> str:
    """A scene's stage name with the stage's tension."""
    tension = next((s.tension for s in stages_of(episode) if s.name == source), None)
    return f"{source} (긴장도 {tension})" if tension is not None else source


def scene_lines(episode: EpisodeCard, scenes: Sequence[Scene]) -> list[str]:
    """Each scene in story order with its stage's tension, summary and core."""
    lines: list[str] = []
    for scene in scenes:
        stage = stage_label(episode, scene.source)
        lines += [f"{scene.scene}. {stage}: {scene.summary}", f"   핵심: {scene.core}"]
    return lines


def arrange_turns(episode: EpisodeCard, scenes: Sequence[Scene]) -> list[Message]:
    """§9: the episode's name and synopsis, then its scenes in story order."""
    story = [
        *labelled("제목", episode.name),
        *labelled("줄거리", episode.data.synopsis),
        "장면 (이야기 순서):",
        *scene_lines(episode, scenes),
    ]
    return [
        {
            "role": "user",
            "content": "\n".join(
                [
                    block("원문", "\n".join(story)),
                    block("지시", f"배치할 장면: 1~{len(scenes)}번 ({len(scenes)}개)"),
                ]
            ),
        }
    ]


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


def beat_line(beat: PlanBeat) -> str:
    style = f"{beat.pov}, {beat.mode}·{beat.focus}·{beat.density}, 긴장도 {beat.tension}"
    return f"{beat.order}. ({style}) {beat.summary}"


def technique_lines(card: Technique) -> list[str]:
    """id, name, definition, how to apply it and when not to: never the example (§9)."""
    return [
        f"- {card.id} {card.name}: {card.description}",
        f"  적용 방법: {card.mechanism}",
        f"  피할 경우: {' / '.join(card.avoid_when)}",
    ]


def direct_story(episode: EpisodeCard, spot: SceneSpot) -> list[str]:
    scene = spot.scene
    lines = [
        *labelled("에피소드 제목", episode.name),
        *labelled("주제", episode.data.theme),
        *labelled("줄거리", episode.data.synopsis),
        "",
        "이번 장면:",
        f"  단계: {stage_label(episode, scene.source)}",
        f"  요약: {scene.summary}",
        f"  핵심: {scene.core}",
    ]
    if scene.reveal:
        lines += ["  이 장면에서 드러낼 것:", *(f"  - {text}" for text in scene.reveal)]
    lines.append("")
    if spot.previous is None:
        lines.append("앞 장면: 없음 (에피소드의 첫 장면)")
    else:
        lines.append(f"앞 장면: {spot.previous.summary}")
        if spot.previous.beats:
            lines += ["  앞 장면의 비트:", *(f"  {beat_line(b)}" for b in spot.previous.beats)]
    if spot.next is None:
        lines.append("뒤 장면: 없음 (에피소드의 마지막 장면)")
    else:
        lines.append(f"뒤 장면: {spot.next.summary}")
    return lines


def direct_turns(
    conn: sqlite3.Connection,
    episode: EpisodeCard,
    spot: SceneSpot,
    chosen: Sequence[Technique],
    serial: Sequence[Technique],
    beats: tuple[int, int],
) -> list[Message]:
    """§9: the scene in its episode with its neighbours, the episode's cards, then its place,
    size and cards (chosen, then serial by place)."""
    ties = cards_db.episode_ties(conn, episode.id)
    low, high = beats
    count = f"{low}개" if low == high else f"{low}~{high}개"
    order = [
        f"자리: {spot.chapter}화의 {PLACE_TEXT[spot.place]}",
        f"분량: {spot.scene.target_chars}자, 비트 {count}",
        "고른 기법:",
        *(line for card in chosen for line in technique_lines(card)),
        "연재 기법:",
        *(line for card in serial for line in technique_lines(card)),
    ]
    return [
        {
            "role": "user",
            "content": "\n".join(
                [
                    block("원문", "\n".join(direct_story(episode, spot))),
                    block("참고 카드", card_lines(conn, episode, ties)),
                    block("지시", "\n".join(order)),
                ]
            ),
        }
    ]
