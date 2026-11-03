"""Step 2 eval cases: checks every case before it is used (§20 step 2).

    uv run python eval/step2/check.py

Each genre's episodes are saved, with the unit 15 seed cards they build on, into a throwaway
database through the app's own card save, and must come out complete (§14 status). Gold
techniques must exist and be direction candidates: scope 장면 or 회차, not one of the serial
cards direct always gets (§9). Exits 1 on any problem.
"""

import json
import sys
import tempfile
from pathlib import Path
from typing import Any

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent / "unit15"))

from aiplot.services import cards, techniques  # noqa: E402
from run import BLANK, merged, open_work  # noqa: E402

GENRES = ["fantasy", "hunter", "romance", "wuxia", "mystery", "scifi"]
SERIAL = {"회차 끝 절단", "회차 3단 설계", "전회 연결 도입", "사이다/고구마 완급"}
SCORED = 20


def load(genre: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    doc = json.loads((HERE / "cases" / f"{genre}.json").read_text(encoding="utf-8"))
    seeds = json.loads((HERE / "cases" / doc["seeds"]).read_text(encoding="utf-8"))["seeds"]
    return doc, seeds


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


def check_genre(genre: str, catalog: dict[str, Any]) -> tuple[list[str], int]:
    problems: list[str] = []
    doc, seeds = load(genre)
    scored = 0
    with tempfile.TemporaryDirectory() as tmp:
        conn, work_id = open_work(Path(tmp), seeds)
        try:
            for episode in doc["episodes"]:
                cards.save(conn, episode_card(episode, work_id))
            for episode in doc["episodes"]:
                row = conn.execute(
                    "SELECT status, data FROM card WHERE id = ?", (episode["id"],)
                ).fetchone()
                if row["status"] != "complete":
                    problems.append(f"{episode['id']}: saved as {row['status']}")
                saved = json.loads(row["data"])
                for key in ("characters", "fulfills", "world"):
                    if saved[key] != episode["data"][key]:
                        problems.append(f"{episode['id']}: {key} not kept on save")
                stages = {s["name"] for s in episode["data"]["structure"]["stages"]}
                for gold in episode["gold"]:
                    scored += 1
                    if gold["stage"] not in stages:
                        problems.append(f"{episode['id']}: no stage {gold['stage']}")
                    for technique_id in gold["accept"]:
                        card = catalog.get(technique_id)
                        if card is None:
                            problems.append(f"{episode['id']}: unknown {technique_id}")
                        elif not {"장면", "회차"} & set(card.scope):
                            problems.append(f"{episode['id']}: {technique_id} not a candidate")
                        elif card.name in SERIAL:
                            problems.append(f"{episode['id']}: {technique_id} is a serial card")
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
