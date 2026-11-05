"""Step 2: scene split, candidate narrowing and pick on the real model (§20 step 2).

Start llama-server by hand with the base profile's GGUF and flags (§17), then:
    uv run python eval/step2/run_direction.py --url http://127.0.0.1:8796 \
        --out eval/results/step2/run1.json

Each genre's completed seeds and episodes go into a throwaway database through the app's card
save (check.py). Per episode, the app's own code: `direction.split_scenes` (the scene role,
one more generation when cleaning leaves nothing), then for every scene whose source is one of
the episode's scored stages, `direction.candidates` (narrowing, §9) and `direction.recommend`
(the pick role). Scenes of unscored stages get no pick call. Roles keep their configured
settings (config/roles.yaml). `--fake` uses the fixture client instead of a server (a check
of the runner and scorer, not a measurement). Results hold raw model output and prompts and
stay out of git (eval/results/ is gitignored); score_direction.py scores them.
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

from aiplot.generated.roles.scene_output import OutputScene  # noqa: E402
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


def failure(exc: Exception) -> dict[str, str]:
    """A failed call's error; the run goes on."""
    code = exc.code if isinstance(exc, LlmError) else type(exc).__name__
    return {"error": code, "message": str(exc)[:500]}


async def run_scene_pick(
    router: Router, conn: Any, episode_id: str, scene: OutputScene
) -> dict[str, Any]:
    """Candidates (kept even when the pick call fails) and the pick role's combinations."""
    record: dict[str, Any] = {"scene": scene.scene, "source": scene.source}
    found = direction.candidates(conn, scene.effects, scene.situations)
    record["candidates"] = [card.id for card in found]
    if not found:
        return {**record, "error": "NO_CANDIDATES", "message": "no candidate shares a tag"}
    episode = direction.ready_episode(conn, episode_id)
    stage = next(s for s in context.stages_of(episode) if s.name == scene.source)
    record["prompt"] = context.pick_turns(episode, stage, scene, found)[0]["content"]
    started = time.perf_counter()
    try:
        result = await direction.recommend(router, conn, episode_id, scene)
    except Exception as exc:
        return {**record, **failure(exc), "failed_after_s": round(time.perf_counter() - started, 1)}
    return {
        **record,
        "picks": [pick.model_dump(mode="json") for pick in result.picks],
        "generations": result.generations,
        "usage": usage(result.usage),
        "total_s": round(time.perf_counter() - started, 1),
    }


async def run_episode(router: Router, conn: Any, episode: dict[str, Any]) -> dict[str, Any]:
    record: dict[str, Any] = {"id": episode["id"], "name": episode["name"]}
    scored = {gold["stage"] for gold in episode["gold"]}
    started = time.perf_counter()
    try:
        card = direction.ready_episode(conn, episode["id"])
        record["prompt"] = context.scene_turns(conn, card)[0]["content"]
        started = time.perf_counter()
        result = await direction.split_scenes(router, conn, episode["id"])
    except Exception as exc:
        return {
            **record,
            "scene_call": {
                **failure(exc),
                "failed_after_s": round(time.perf_counter() - started, 1),
            },
            "scenes": [],
            "picks": [],
        }
    record["scene_call"] = {
        "generations": result.generations,
        "usage": usage(result.usage),
        "total_s": round(time.perf_counter() - started, 1),
    }
    record["scenes"] = [scene.model_dump(mode="json") for scene in result.scenes]
    record["picks"] = []
    for scene in result.scenes:
        if scene.source not in scored:
            continue
        print(f"  pick {episode['id']} scene {scene.scene} ({scene.source})", flush=True)
        record["picks"].append(await run_scene_pick(router, conn, episode["id"], scene))
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
                    print(f"scene {episode['id']}", flush=True)
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
