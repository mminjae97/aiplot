"""Step 4: the 20 direction plans to score (§20 step 4), on the real model.

Start llama-server by hand with the base profile's GGUF and flags (§17), alone on the PC, then:
    uv run python eval/step4/run_bundles.py --url http://127.0.0.1:8796 \
        --out eval/results/step4/run1.json

Each genre's step 2 case and the step 4 episodes continuing it (check_cases.load_genre) go into
a throwaway database through the app's card save. Per episode, step 3's runner
(run_plan.run_episode): `scene`, `arrange`, `build_plan`, then each scene in narration order
with the first recommended card chosen and `direct`, its beats going back into the plan. Each
record also keeps what the scoring page shows beside the plan: the episode as saved (theme,
synopsis, stages, foreshadowing planted and paid off) and the text of every technique card the
plan names. `--fake` uses the fixture client (a check of the scripts; its 4-stage episodes fail
the scene call, the fixture's scenes being 5-stage). `--episodes ID…` runs a subset.
`--redirect RESULTS` takes an earlier run's scenes and arrangement and runs only `direct`
again (what a change of the direct role does to the same plans). Results are written after
every episode and stay out of git (eval/results/ is gitignored).
"""

import argparse
import asyncio
import json
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent / "unit15"))
sys.path.insert(0, str(HERE.parent / "step2"))
sys.path.insert(0, str(HERE.parent / "step3"))

from aiplot.db import cards as cards_db  # noqa: E402
from aiplot.db import techniques as techniques_db  # noqa: E402
from aiplot.generated.direction.plan import DirectionPlan  # noqa: E402
from aiplot.llm.client import LlamaClient  # noqa: E402
from aiplot.llm.config import load_llm_config  # noqa: E402
from aiplot.llm.fake import FakeClient  # noqa: E402
from aiplot.llm.router import Router  # noqa: E402
from aiplot.services import cards  # noqa: E402
from check import GENRES, open_cases  # noqa: E402
from check_cases import load_genre  # noqa: E402
from run import write  # noqa: E402
from run_plan import direct_all, run_episode  # noqa: E402


def episode_view(conn: Any, episode_id: str) -> dict[str, Any]:
    """The episode as the scoring page shows it: what it was written to be."""
    card = cards.get(conn, episode_id)
    assert card is not None
    data = card.model_dump(mode="json")["data"]
    ties = cards_db.episode_ties(conn, episode_id)
    return {
        "name": card.name,
        "theme": data["theme"],
        "synopsis": data["synopsis"],
        "structure": data["structure"],
        "plants": [text for _, text in ties.plants],
        "payoffs": [text for _, text in ties.payoffs],
    }


def named_techniques(conn: Any, plan: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    """Every card the plan chose or a beat names: what the scorer needs to judge its fit."""
    ids: list[str] = []
    for chapter in (plan or {}).get("chapters", []):
        for scene in chapter["scenes"]:
            ids += scene["chosen"]
            for beat in scene["beats"]:
                ids += beat["techniques"]
    found = {}
    for technique_id in dict.fromkeys(ids):
        card = techniques_db.get(conn, technique_id)
        if card is not None:
            found[technique_id] = {
                "name": card.name,
                "description": card.description,
                "mechanism": card.mechanism,
            }
    return found


async def redirected(router: Router, conn: Any, earlier: dict[str, Any]) -> dict[str, Any]:
    """An earlier run's episode directed again: its scenes and arrangement as they were, every
    scene's beats dropped first (a scene's beats may not repeat another scene's), then
    run_plan.direct_all. What a change of the direct role alone does."""
    for chapter in earlier["plan"]["chapters"]:
        for scene in chapter["scenes"]:
            scene.update({"beats": [], "status": "undirected", "chosen": []})
    record: dict[str, Any] = {
        key: earlier[key] for key in ("id", "name", "scenes") if key in earlier
    }
    plan = await direct_all(router, conn, DirectionPlan.model_validate(earlier["plan"]), record)
    record["plan"] = plan.model_dump(mode="json")
    return record


async def main() -> None:
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--url")
    source.add_argument("--fake", action="store_true", help="fixture client, no model")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--episodes", nargs="+", metavar="ID", help="only these episode ids")
    parser.add_argument(
        "--redirect",
        type=Path,
        metavar="RESULTS",
        help="an earlier run's results: its scenes and arrangement kept, only direct run again",
    )
    args = parser.parse_args()

    earlier = {}
    if args.redirect:
        plans = json.loads(args.redirect.read_text(encoding="utf-8"))["episodes"]
        earlier = {record["id"]: record for record in plans if record.get("plan")}
    client = None if args.fake else LlamaClient(args.url)
    router = Router(load_llm_config(), client or FakeClient(), lora_dir=HERE / "no-lora")
    results: dict[str, Any] = {
        "started_at": datetime.now(UTC).isoformat(),
        "fake": args.fake,
        "episodes": [],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    for genre in GENRES:
        doc, seeds, _ = load_genre(genre)
        wanted = [e for e in doc["episodes"] if not args.episodes or e["id"] in args.episodes]
        if not wanted:
            continue
        with tempfile.TemporaryDirectory() as tmp:
            conn, _ = open_cases(Path(tmp), doc, seeds)
            try:
                for episode in wanted:
                    print(f"episode {episode['id']}", flush=True)
                    if args.redirect:
                        if episode["id"] not in earlier:
                            continue
                        record = await redirected(router, conn, earlier[episode["id"]])
                    else:
                        record = await run_episode(router, conn, episode)
                    record["episode"] = episode_view(conn, episode["id"])
                    record["techniques"] = named_techniques(conn, record.get("plan"))
                    results["episodes"].append({"genre": genre, **record})
                    write(args.out, results)
            finally:
                conn.close()
    if client is not None:
        await client.aclose()
    results["finished_at"] = datetime.now(UTC).isoformat()
    if write(args.out, results):
        print(f"wrote {args.out}")


if __name__ == "__main__":
    asyncio.run(main())
