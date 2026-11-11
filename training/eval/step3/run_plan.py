"""Step 3: direction plans on the real model (§20 step 3: schema pass >=95% per role).

Start llama-server by hand with the base profile's GGUF and flags (§17), then:
    uv run python eval/step3/run_plan.py --url http://127.0.0.1:8796 \
        --out eval/results/step3/run1.json

The step 2 cases (each genre's completed seeds and its episodes, eval/step2/cases) go into a
throwaway database through the app's card save. Per episode, the app's own code:
`direction.split_scenes`, `direction.arrange_scenes`, `direction.build_plan`, then each scene
in narration order gets the first recommended card as its one chosen card (standing in for a
user who takes the first recommendation; no card when nothing is recommended) and
`direction.direct_scene`, its beats going back into the plan (status directed) so the next scene
sees them. Roles keep their configured settings (config/roles.yaml). `--fake` uses the fixture
client (a check of the runner and scorer, not a measurement). Results hold prompts and plans and
stay out of git (eval/results/ is gitignored); score_plan.py scores them.
"""

import argparse
import asyncio
import sys
import tempfile
import time
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent / "unit15"))
sys.path.insert(0, str(HERE.parent / "step2"))

from aiplot.generated.direction.plan import DirectionPlan, PlanBeat  # noqa: E402
from aiplot.llm.client import LlamaClient, LlmError, Usage  # noqa: E402
from aiplot.llm.config import load_llm_config  # noqa: E402
from aiplot.llm.fake import FakeClient  # noqa: E402
from aiplot.llm.router import Router  # noqa: E402
from aiplot.services import direction  # noqa: E402
from aiplot.services import direction_context as context  # noqa: E402
from check import GENRES, load, open_cases  # noqa: E402
from run import write  # noqa: E402


def usage(value: Usage | None) -> dict[str, int] | None:
    return asdict(value) if value is not None else None


def failure(exc: Exception, started: float) -> dict[str, Any]:
    """A failed call's error; the run goes on."""
    code = exc.code if isinstance(exc, LlmError) else type(exc).__name__
    return {
        "error": code,
        "message": str(exc)[:500],
        "failed_after_s": round(time.perf_counter() - started, 1),
    }


def updated(plan: DirectionPlan, number: int, changes: dict[str, Any]) -> DirectionPlan:
    """The plan with one scene's fields changed."""
    return plan.model_copy(
        update={
            "chapters": [
                chapter.model_copy(
                    update={
                        "scenes": [
                            s.model_copy(update=changes) if s.scene == number else s
                            for s in chapter.scenes
                        ]
                    }
                )
                for chapter in plan.chapters
            ]
        }
    )


def narration_order(plan: DirectionPlan) -> list[int]:
    return [scene.scene for chapter in plan.chapters for scene in chapter.scenes]


async def direct_all(
    router: Router, conn: Any, plan: DirectionPlan, record: dict[str, Any]
) -> DirectionPlan:
    """Every scene in narration order: the first recommendation chosen, then direct."""
    record["direct_calls"] = []
    record["direct_prompts"] = {}
    for number in narration_order(plan):
        spot = direction.locate(plan, number)
        chosen = [r.technique for r in spot.scene.recommended[:1]]
        plan = updated(plan, number, {"chosen": chosen})
        call: dict[str, Any] = {
            "scene": number,
            "chapter": spot.chapter,
            "place": spot.place,
            "chosen": chosen,
        }
        if not chosen:
            record["direct_calls"].append({**call, "skipped": "no recommended card"})
            continue
        print(f"  direct scene {number}", flush=True)
        started = time.perf_counter()
        try:
            prepared = direction.prepare_direct(conn, plan, number)
            record["direct_prompts"][str(number)] = prepared.turns[0]["content"]
            started = time.perf_counter()
            result = await direction.direct_scene(router, conn, plan, number)
        except Exception as exc:
            record["direct_calls"].append({**call, **failure(exc, started)})
            continue
        beats: list[PlanBeat] = result.beats
        plan = updated(plan, number, {"beats": beats, "status": "directed"})
        record["direct_calls"].append(
            {
                **call,
                "generations": result.generations,
                "usage": usage(result.usage),
                "total_s": round(time.perf_counter() - started, 1),
                "beats": len(beats),
                "repeated": result.repeated,
            }
        )
    return plan


async def run_episode(router: Router, conn: Any, episode: dict[str, Any]) -> dict[str, Any]:
    record: dict[str, Any] = {"id": episode["id"], "name": episode["name"]}
    started = time.perf_counter()
    try:
        result = await direction.split_scenes(router, conn, episode["id"])
    except Exception as exc:
        return {**record, "scene_call": failure(exc, started)}
    record["scene_call"] = {
        "generations": result.generations,
        "usage": usage(result.usage),
        "total_s": round(time.perf_counter() - started, 1),
    }
    scenes = result.scenes
    record["scenes"] = [scene.model_dump(mode="json") for scene in scenes]

    card = direction.ready_episode(conn, episode["id"])
    record["arrange_prompt"] = context.arrange_turns(card, scenes)[0]["content"]
    print(f"  arrange ({len(scenes)} scenes)", flush=True)
    started = time.perf_counter()
    try:
        arranged = await direction.arrange_scenes(router, conn, episode["id"], scenes)
    except Exception as exc:
        record["arrange_call"] = failure(exc, started)
        return record
    record["arrange_call"] = {
        "generations": arranged.generations,
        "usage": usage(arranged.usage),
        "total_s": round(time.perf_counter() - started, 1),
        "chapters": len(arranged.chapters),
    }
    plan = direction.build_plan(conn, episode["id"], scenes, arranged.chapters)
    plan = await direct_all(router, conn, plan, record)
    record["plan"] = plan.model_dump(mode="json")
    return record


async def main() -> None:
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--url")
    source.add_argument("--fake", action="store_true", help="fixture client, no model")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--episodes", nargs="+", metavar="ID", help="only these episode ids")
    args = parser.parse_args()

    client = None if args.fake else LlamaClient(args.url)
    router = Router(load_llm_config(), client or FakeClient(), lora_dir=HERE / "no-lora")
    results: dict[str, Any] = {
        "started_at": datetime.now(UTC).isoformat(),
        "fake": args.fake,
        "episodes": [],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    # Written after every episode, so a crash keeps what was done (no finished_at until the end).
    for genre in GENRES:
        doc, seeds = load(genre)
        wanted = [e for e in doc["episodes"] if not args.episodes or e["id"] in args.episodes]
        if not wanted:
            continue
        with tempfile.TemporaryDirectory() as tmp:
            conn, _ = open_cases(Path(tmp), doc, seeds)
            try:
                for episode in wanted:
                    print(f"episode {episode['id']}", flush=True)
                    results["episodes"].append(
                        {"genre": genre, **await run_episode(router, conn, episode)}
                    )
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
