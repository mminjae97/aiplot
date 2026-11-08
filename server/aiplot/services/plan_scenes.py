"""The user's edits to a stored plan (§9): a scene's devices, its cards, and the narration order
and cuts. Each edit reads and writes the plan and its picks in one transaction, while direction
is the current stage.

A directed or confirmed scene becomes stale (다시 연출 필요) when what its beats were directed
from changes: its cards, its chapter, its place in it, its neighbours in narration order or its
target. Devices only change the recommendations.
"""

import sqlite3
from collections.abc import Generator, Sequence
from contextlib import contextmanager

from aiplot.db import plans as plans_db
from aiplot.db import techniques as techniques_db
from aiplot.db.connection import transaction
from aiplot.generated.direction.plan import DirectionPlan, PlanBeat, PlanChapter, PlanScene
from aiplot.generated.direction.plan_record import PlanRecord
from aiplot.generated.direction.plan_status import PlanStatus
from aiplot.generated.direction.scene_beats import BeatEdit
from aiplot.generated.technique.technique_device import TechniqueDevice
from aiplot.services import direction, plans, works

# Chapters per episode (§9).
MAX_CHAPTERS = 5

DIRECTED = frozenset({"directed", "confirmed"})

type SpotKey = tuple[int, str, int | None, int | None, int]


class PlanNotFoundError(LookupError):
    pass


class SceneNotFoundError(LookupError):
    pass


class LayoutInvalidError(ValueError):
    """Not 1-5 non-empty chapters holding every scene exactly once."""


class SceneNotDirectedError(ValueError):
    """Beats to edit or confirm need a directed scene: not undirected, and for confirming not
    stale either (direct it again first)."""


class BeatsInvalidError(ValueError):
    """A beat names a card the scene may not use, or there are more beats than characters."""


class ChoiceRefusedError(ValueError):
    """The cards cannot direct the scene; code is the API's (§16)."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def scenes_of(plan: DirectionPlan) -> list[PlanScene]:
    """In narration order."""
    return [scene for chapter in plan.chapters for scene in chapter.scenes]


def scene_in(plan: DirectionPlan, number: int) -> PlanScene:
    for scene in scenes_of(plan):
        if scene.scene == number:
            return scene
    raise SceneNotFoundError(f"no scene {number} in the plan")


def status_of(plan: DirectionPlan) -> PlanStatus:
    """Confirmed when every scene is (§9)."""
    if all(scene.status == "confirmed" for scene in scenes_of(plan)):
        return "confirmed"
    return "directing"


@contextmanager
def editing(conn: sqlite3.Connection, plan_id: str) -> Generator[DirectionPlan]:
    """The plan to change in place; written back with its status when the block ends without
    an error, nothing written otherwise."""
    with transaction(conn):
        record = plans_db.get(conn, plan_id)
        if record is None:
            raise PlanNotFoundError(plan_id)
        work_id = plans.work_of_episode(conn, record.episode_id)
        works.require_current(conn, work_id, plans.DIRECTION_STAGE)
        plan = record.plan
        yield plan
        plans_db.update(conn, plan_id, status_of(plan), plan)


def stored(conn: sqlite3.Connection, plan_id: str) -> PlanRecord:
    record = plans_db.get(conn, plan_id)
    assert record is not None
    return record


def set_devices(
    conn: sqlite3.Connection, plan_id: str, number: int, devices: Sequence[TechniqueDevice]
) -> PlanRecord:
    """The user's checked devices (each once); the scene's recommendations follow at once."""
    with editing(conn, plan_id) as plan:
        scene = scene_in(plan, number)
        scene.devices = list(dict.fromkeys(devices))
        scene.recommended = direction.plan_recommendations(
            conn, scene.devices, scene.effects, scene.situations
        )
        plans_db.write_picks(conn, plan_id, number, plans.picks(conn, scene))
    return stored(conn, plan_id)


def pick(
    conn: sqlite3.Connection, plan_id: str, number: int, technique_ids: Sequence[str]
) -> PlanRecord:
    """The cards to direct the scene with (each once, in the user's order; at least one, as the
    request schema requires): recommended or any other direction candidate, 1-3, none
    conflicting. New cards on a directed or confirmed scene make it stale; its beats stay until
    it is directed again."""
    chosen = list(dict.fromkeys(technique_ids))
    with editing(conn, plan_id) as plan:
        scene = scene_in(plan, number)
        found = [techniques_db.get(conn, technique_id) for technique_id in chosen]
        cards = [card for card in found if card is not None]
        if len(cards) < len(found):
            raise ChoiceRefusedError("TECHNIQUE_NOT_CANDIDATE", "an unknown card")
        error = direction.choice_error(cards)
        if error is not None:
            raise ChoiceRefusedError(error, f"cards refused: {error}")
        if chosen != scene.chosen and scene.status in DIRECTED:
            scene.status = "stale"
        scene.chosen = chosen
        plans_db.write_picks(conn, plan_id, number, plans.picks(conn, scene))
    return stored(conn, plan_id)


def spot_key(plan: DirectionPlan, number: int) -> SpotKey:
    """What a scene's beats were directed from in the plan's layout."""
    spot = direction.locate(plan, number)
    previous = spot.previous.scene if spot.previous is not None else None
    following = spot.next.scene if spot.next is not None else None
    return (spot.chapter, spot.place, previous, following, spot.scene.target_chars)


def rearrange(
    conn: sqlite3.Connection, plan_id: str, layout: Sequence[Sequence[int]]
) -> PlanRecord:
    """The user's narration order and cuts: chapters numbered 1..n, each scene's target rescaled
    from the targets it had so a chapter's sum to CHAPTER_CHARS; directed or confirmed scenes
    whose chapter, place, neighbours or target changed become stale."""
    with editing(conn, plan_id) as plan:
        by_number = {scene.scene: scene for scene in scenes_of(plan)}
        flat = [number for chapter in layout for number in chapter]
        if (
            not 1 <= len(layout) <= MAX_CHAPTERS
            or any(not chapter for chapter in layout)
            or sorted(flat) != sorted(by_number)
        ):
            raise LayoutInvalidError("every scene exactly once in 1-5 non-empty chapters")
        before = {number: spot_key(plan, number) for number in by_number}
        chapters: list[PlanChapter] = []
        for index, numbers in enumerate(layout, start=1):
            scenes = [by_number[number] for number in numbers]
            weights = [scene.target_chars for scene in scenes]
            for scene, target in zip(
                scenes, direction.rescale(weights, direction.CHAPTER_CHARS), strict=True
            ):
                scene.target_chars = target
            chapters.append(
                PlanChapter(chapter=index, target_chars=direction.CHAPTER_CHARS, scenes=scenes)
            )
        plan.chapters = chapters
        for number, scene in by_number.items():
            if scene.status in DIRECTED and spot_key(plan, number) != before[number]:
                scene.status = "stale"
    return stored(conn, plan_id)


# Beats ---------------------------------------------------------------------------------------


def allowed_techniques(plan: DirectionPlan, number: int) -> list[str]:
    """The cards a scene's beats may name: its chosen ones and the serial cards for its place."""
    spot = direction.locate(plan, number)
    return [*spot.scene.chosen, *direction.serial_for(spot.place)]


def set_beats(
    conn: sqlite3.Connection, plan_id: str, number: int, beats: Sequence[BeatEdit]
) -> PlanRecord:
    """The user's beats for a directed scene: numbered 1..n, targets rescaled to the scene's,
    texts stripped, each card once. A confirmed scene goes back to directed (confirm again); a
    stale one stays stale."""
    with editing(conn, plan_id) as plan:
        scene = scene_in(plan, number)
        if scene.status == "undirected":
            raise SceneNotDirectedError(f"scene {number} has no beats yet")
        allowed = allowed_techniques(plan, number)
        named = {technique for beat in beats for technique in beat.techniques}
        if not named <= set(allowed):
            raise BeatsInvalidError(
                f"cards not chosen for scene {number}: {sorted(named - set(allowed))}"
            )
        if len(beats) > scene.target_chars:
            raise BeatsInvalidError(f"more beats than the scene's {scene.target_chars} characters")
        targets = direction.rescale([beat.target_chars for beat in beats], scene.target_chars)
        scene.beats = [
            PlanBeat(
                order=order,
                summary=beat.summary.strip(),
                techniques=list(dict.fromkeys(beat.techniques)),
                pov=beat.pov.strip(),
                mode=beat.mode,
                focus=beat.focus,
                density=beat.density,
                tension=beat.tension,
                target_chars=target,
            )
            for order, (beat, target) in enumerate(zip(beats, targets, strict=True), start=1)
        ]
        if scene.status == "confirmed":
            scene.status = "directed"
    return stored(conn, plan_id)


def confirm(conn: sqlite3.Connection, plan_id: str, number: int) -> PlanRecord:
    """The user accepts the scene's beats; the plan is confirmed once every scene is (§9)."""
    with editing(conn, plan_id) as plan:
        scene = scene_in(plan, number)
        if scene.status in ("undirected", "stale"):
            raise SceneNotDirectedError(f"scene {number} is {scene.status}: direct it first")
        scene.status = "confirmed"
    return stored(conn, plan_id)


def store_beats(
    conn: sqlite3.Connection,
    plan_id: str,
    number: int,
    beats: Sequence[PlanBeat],
    basis: tuple[SpotKey, list[str]],
) -> PlanRecord:
    """A direct job's beats. The scene is directed if its place and cards are still what the
    beats were directed from (basis_of), else stale: the user changed them while it ran."""
    with editing(conn, plan_id) as plan:
        scene = scene_in(plan, number)
        scene.beats = list(beats)
        scene.status = "directed" if basis_of(plan, number) == basis else "stale"
    return stored(conn, plan_id)


def basis_of(plan: DirectionPlan, number: int) -> tuple[SpotKey, list[str]]:
    """What a direct call reads of the plan for the scene: its place and its chosen cards."""
    return spot_key(plan, number), list(scene_in(plan, number).chosen)
