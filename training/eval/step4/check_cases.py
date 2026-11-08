"""Step 4 eval cases: checks every case before it is used (§20 step 4).

    uv run python eval/step4/check_cases.py

Each genre's step 2 case (seeds completed, its episodes) is saved together with the step 4
episodes that continue it, through the app's own card save as `eval/step2/check.py` does. Every
card must come out complete (an inactive episode is refused by `scene`, §11) and every
reference must resolve to its relation row. The 20 episodes are the 20 bundles: step 4 episode
ids must be new, and the rubric must name the five items of §20 step 4. Exits 1 on any problem.
"""

import json
import sys
import tempfile
from pathlib import Path
from typing import Any

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent / "step2"))
sys.path.insert(0, str(HERE.parent / "unit15"))

from check import GENRES, load, open_cases, unresolved  # noqa: E402

BUNDLES = 20
RUBRIC_KEYS = ["tension", "cut", "reveal", "pov", "technique"]
STAGE_NAMES = {4: ["기", "승", "전", "결"], 5: ["발단", "전개", "위기", "절정", "결말"]}


def load_genre(genre: str) -> tuple[dict[str, Any], list[dict[str, Any]], set[str]]:
    """The step 2 case of the genre with the step 4 episodes appended, its completed seeds, and
    the ids of the step 4 episodes."""
    extra = json.loads((HERE / "cases" / f"{genre}.json").read_text(encoding="utf-8"))
    base = (HERE / "cases" / extra["base"]).resolve()
    if base != (HERE.parent / "step2" / "cases" / f"{genre}.json").resolve():
        raise ValueError(f"{genre}: base is not the step 2 case of the genre")
    doc, seeds = load(genre)
    new = {episode["id"] for episode in extra["episodes"]}
    if new & {episode["id"] for episode in doc["episodes"]}:
        raise ValueError(f"{genre}: step 4 reuses a step 2 episode id")
    return {**doc, "episodes": doc["episodes"] + extra["episodes"]}, seeds, new


def check_genre(genre: str) -> tuple[list[str], int]:
    problems: list[str] = []
    doc, seeds, new = load_genre(genre)
    with tempfile.TemporaryDirectory() as tmp:
        conn, _ = open_cases(Path(tmp), doc, seeds)
        try:
            for row in conn.execute("SELECT id, status FROM card WHERE status != 'complete'"):
                problems.append(f"{row['id']}: saved as {row['status']}")
            for episode in doc["episodes"]:
                problems += unresolved(conn, episode)
                if episode["id"] in new:
                    structure = episode["data"]["structure"]
                    names = [stage["name"] for stage in structure["stages"]]
                    if names != STAGE_NAMES[structure["type"]]:
                        problems.append(f"{episode['id']}: stages {names}")
        finally:
            conn.close()
    return problems, len(doc["episodes"])


def check_rubric() -> list[str]:
    rubric = json.loads((HERE / "rubric.json").read_text(encoding="utf-8"))
    problems = []
    keys = [item["key"] for item in rubric["items"]]
    if keys != RUBRIC_KEYS:
        problems.append(f"rubric items {keys}, want {RUBRIC_KEYS}")
    for item in rubric["items"]:
        if sorted(item["anchors"]) != ["1", "3", "5"]:
            problems.append(f"rubric {item['key']}: anchors {sorted(item['anchors'])}")
    return problems


def main() -> None:
    problems = check_rubric()
    bundles = 0
    for genre in GENRES:
        found, count = check_genre(genre)
        problems += [f"{genre}: {p}" for p in found]
        bundles += count
    if bundles != BUNDLES:
        problems.append(f"{bundles} episodes, want {BUNDLES}")
    for problem in problems:
        print(problem)
    print(f"{bundles} bundles, {len(problems)} problems")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
