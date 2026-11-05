"""Step 2 eval cases: checks every case before it is used (§20 step 2).

    uv run python eval/step2/check.py

Each genre's episodes are saved, with the unit 15 seed cards they build on (completed by the
case file's `complete_seeds`), into a throwaway database through the app's own card save. Every
seed card must come out complete (an incomplete one is inactive, §11, and never reaches the
`scene` context), and every episode complete (§14 status) with every
reference they make (part, characters, world, places, links, milestones, foreshadowing payoffs)
written as a relation row, i.e. resolved to a seed card, another case episode, a milestone or a
foreshadowing planted in another case episode. Episodes are saved twice, so a reference to one
later in the file resolves too. Gold techniques must exist and be direction candidates
(`direction.is_candidate`: scope 장면 or 회차, not one of the serial cards direct always gets,
§9). Exits 1 on any problem.
"""

import json
import sys
import tempfile
from pathlib import Path
from typing import Any

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent / "unit15"))

from aiplot.services import cards, direction, techniques  # noqa: E402
from run import BLANK, merged, open_work  # noqa: E402

GENRES = ["fantasy", "hunter", "romance", "wuxia", "mystery", "scifi"]
SCORED = 20


def load(genre: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """The genre's case file and its seed cards: the unit 15 seeds, each with the fields
    `complete_seeds` gives it merged into its data (the unit 15 files stay as they are)."""
    doc = json.loads((HERE / "cases" / f"{genre}.json").read_text(encoding="utf-8"))
    seeds = json.loads((HERE / "cases" / doc["seeds"]).read_text(encoding="utf-8"))["seeds"]
    fills: dict[str, Any] = doc["complete_seeds"]
    unknown = set(fills) - {seed["id"] for seed in seeds}
    if unknown:
        raise ValueError(f"{genre}: complete_seeds names no seed {sorted(unknown)}")
    return doc, [
        {**seed, "data": merged(seed["data"], fills[seed["id"]])} if seed["id"] in fills else seed
        for seed in seeds
    ]


def episode_card(episode: dict[str, Any], work_id: str) -> Any:
    return cards.CARD.validate_python(
        {
            "id": episode["id"],
            "work_id": work_id,
            "type": "episode",
            "name": episode["name"],
            "status": "incomplete",
            "source_notes": "",
            "data": merged(BLANK["episode"], episode["data"]),
            "evidence": {},
            "ai_guess": [],
            "pinned": [],
            "schema_version": 1,
        }
    )


# The relation row each episode reference must leave on save (:ep = the episode, :ref = the
# referenced id). Save keeps `data` verbatim but writes a row only for an id that resolves to a
# card of the work of the right type (or a milestone, or a foreshadowing planted in another
# episode), so a missing row = a dangling id.
REFERENCES = [
    ("part_id", "SELECT 1 FROM episode WHERE card_id = :ep AND part_id = :ref"),
    ("characters", "SELECT 1 FROM episode_character WHERE episode_id = :ep AND card_id = :ref"),
    ("world", "SELECT 1 FROM episode_world WHERE episode_id = :ep AND card_id = :ref"),
    (
        "locations.main",
        "SELECT 1 FROM episode_region WHERE episode_id = :ep AND card_id = :ref AND main = 1",
    ),
    (
        "locations.others",
        "SELECT 1 FROM episode_region WHERE episode_id = :ep AND card_id = :ref AND main = 0",
    ),
    (
        "links.prev",
        "SELECT 1 FROM episode_link WHERE from_id = :ref AND to_id = :ep AND kind = 'order'",
    ),
    (
        "links.next",
        "SELECT 1 FROM episode_link WHERE from_id = :ep AND to_id = :ref AND kind = 'order'",
    ),
    (
        "links.causes",
        "SELECT 1 FROM episode_link WHERE from_id = :ep AND to_id = :ref AND kind = 'cause'",
    ),
    ("fulfills", "SELECT 1 FROM milestone_fill WHERE milestone_id = :ref AND card_id = :ep"),
    (
        "foreshadowing.payoffs",
        "SELECT 1 FROM foreshadowing WHERE id = :ref AND payoff_episode_id = :ep",
    ),
]


def refs_at(data: dict[str, Any], path: str) -> list[str]:
    node: Any = data
    for key in path.split("."):
        node = node[key]
    if node is None:
        return []
    return list(node) if isinstance(node, list) else [node]


def unresolved(conn: Any, episode: dict[str, Any]) -> list[str]:
    """Every id the episode references must appear as its relation row after save."""
    return [
        f"{episode['id']}: {path} {ref} does not resolve"
        for path, sql in REFERENCES
        for ref in refs_at(episode["data"], path)
        if conn.execute(sql, {"ep": episode["id"], "ref": ref}).fetchone() is None
    ]


def check_genre(genre: str, catalog: dict[str, Any]) -> tuple[list[str], int]:
    problems: list[str] = []
    doc, seeds = load(genre)
    scored = 0
    with tempfile.TemporaryDirectory() as tmp:
        conn, work_id = open_work(Path(tmp), seeds)
        try:
            for row in conn.execute("SELECT id, status FROM card WHERE status != 'complete'"):
                problems.append(f"seed {row['id']}: saved as {row['status']}")
            # Twice: the first pass leaves no row for a reference to an episode (or a
            # foreshadowing it plants) later in the file; the second resolves it.
            for _ in range(2):
                for episode in doc["episodes"]:
                    cards.save(conn, episode_card(episode, work_id))
            for episode in doc["episodes"]:
                row = conn.execute(
                    "SELECT status FROM card WHERE id = ?", (episode["id"],)
                ).fetchone()
                if row["status"] != "complete":
                    problems.append(f"{episode['id']}: saved as {row['status']}")
                problems += unresolved(conn, episode)
                stages = {s["name"] for s in episode["data"]["structure"]["stages"]}
                scored_stages = [gold["stage"] for gold in episode["gold"]]
                if len(set(scored_stages)) != 2 or len(scored_stages) != 2:
                    problems.append(f"{episode['id']}: want two distinct scored stages")
                for gold in episode["gold"]:
                    if not gold["accept"]:
                        problems.append(f"{episode['id']}: {gold['stage']} accepts nothing")
                    scored += 1
                    if gold["stage"] not in stages:
                        problems.append(f"{episode['id']}: no stage {gold['stage']}")
                    for technique_id in gold["accept"]:
                        card = catalog.get(technique_id)
                        if card is None:
                            problems.append(f"{episode['id']}: unknown {technique_id}")
                        elif not direction.is_candidate(card):
                            problems.append(f"{episode['id']}: {technique_id} not a candidate")
        finally:
            conn.close()
    return problems, scored


def main() -> None:
    catalog = {card.id: card for card in techniques.load()}
    problems: list[str] = []
    scored = 0
    for genre in GENRES:
        found, count = check_genre(genre, catalog)
        problems += [f"{genre}: {p}" for p in found]
        scored += count
    if scored != SCORED:
        problems.append(f"{scored} scored stages, want {SCORED}")
    for problem in problems:
        print(problem)
    print(f"{scored} scored stages, {len(problems)} problems")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
