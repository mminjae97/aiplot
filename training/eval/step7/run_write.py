"""Step 7: chapters written on the real model (§20 step 7: length within ±10% for >=90%).

Start llama-server by hand with the base profile's GGUF and flags (§17), alone on the PC, then:
    uv run python eval/step7/run_write.py --url http://127.0.0.1:8796 \
        --plans eval/results/step4/run1-all.json --out eval/results/step7/run1.json

The plans are a step 4 run's (run_bundles.py: every scene directed). Each genre's cases go into
a throwaway database as in step 4, direction starts, every episode's plan is stored with its
scenes confirmed (standing in for a user who confirms them as directed), and writing starts:
the app makes the chapters and beats. Each chapter of the wanted episodes is then written by
the app's own chapter job (`writing.start_chapter` on a job queue), in manuscript order, so a
chapter's first beat sees the end of the one before.

Per chapter the record keeps the job's outcome and, per beat, every `write` call made for it
(the target it was given, the user message, the text as it arrived, finish reason, token usage,
seconds; matched to the beat by the place its user message names) and the text as stored. A
further call for a beat = it was written again (a banned phrase or an empty text) or, marked
`continued`, it came short and was continued (§10). Roles keep their configured settings
(config/roles.yaml). `--fake`
uses the fixture client (a check of the runner and scorer, not a measurement). `--episodes ID…`
runs a subset; `--sampling KEY=VALUE…`, `--thinking`, `--max-tokens N` and `--previous-chars N`
change the write role or its context for the run (experiments before a config change). Results
are written after every chapter and stay out of git (eval/results/ is gitignored);
score_write.py scores them.
"""

import argparse
import asyncio
import json
import re
import sys
import tempfile
import time
from collections.abc import AsyncGenerator
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent / "unit15"))
sys.path.insert(0, str(HERE.parent / "step2"))
sys.path.insert(0, str(HERE.parent / "step4"))

from aiplot.db import chapters as chapters_db  # noqa: E402
from aiplot.db import plans as plans_db  # noqa: E402
from aiplot.generated.direction.plan import DirectionPlan  # noqa: E402
from aiplot.jobs.queue import TERMINAL, JobQueue  # noqa: E402
from aiplot.llm.client import ChatRequest, Delta, LlamaClient, LlmClient  # noqa: E402
from aiplot.llm.config import LlmConfig, SamplingOverride, load_llm_config  # noqa: E402
from aiplot.llm.fake import FakeClient  # noqa: E402
from aiplot.llm.router import Router  # noqa: E402
from aiplot.services import manuscript, works, write_context, writing  # noqa: E402
from check import GENRES, open_cases  # noqa: E402
from check_cases import load_genre  # noqa: E402
from run import write  # noqa: E402

TARGET = re.compile(r"^분량: 공백 포함 (\d+)자 안팎$", re.MULTILINE)
# The beat a call is for (its order in the chapter), and the mark of a call continuing one.
ORDER = re.compile(r"^자리: \d+화, 비트 (\d+)/\d+", re.MULTILINE)
CONTINUED = "\n이어 쓰기: "


class RecordingClient:
    """The client, keeping every call: what was asked and what came back."""

    def __init__(self, client: LlmClient) -> None:
        self.client = client
        self.calls: list[dict[str, Any]] = []

    async def stream(self, request: ChatRequest) -> AsyncGenerator[Delta, None]:
        started = time.perf_counter()
        user = request.messages[-1]["content"]
        target = TARGET.search(user)
        order = ORDER.search(user)
        call: dict[str, Any] = {
            "order": int(order.group(1)) if order else None,
            "continued": CONTINUED in user,
            "target": int(target.group(1)) if target else None,
            "user": user,
            "text": "",
            "finish": None,
            "usage": None,
        }
        self.calls.append(call)
        try:
            async for delta in self.client.stream(request):
                if delta.kind == "content":
                    call["text"] += delta.text
                elif delta.kind == "finish":
                    call["finish"] = delta.text
                    call["usage"] = asdict(delta.usage) if delta.usage is not None else None
                yield delta
        finally:
            call["seconds"] = round(time.perf_counter() - started, 1)


def confirmed(plan: dict[str, Any]) -> DirectionPlan:
    """The plan with every scene confirmed as it was directed."""
    for chapter in plan["chapters"]:
        for scene in chapter["scenes"]:
            if not scene["beats"]:
                raise ValueError(f"{plan['episode']}: scene {scene['scene']} has no beats")
            scene["status"] = "confirmed"
    return DirectionPlan.model_validate(plan)


def configured(args: argparse.Namespace) -> tuple[LlmConfig, dict[str, Any]]:
    """The app's config with the write role changed as the run asks (experiments before a
    config change; the run records them): sampling KEY=VALUE pairs, thinking on, max_tokens."""
    config = load_llm_config()
    role = config.roles["write"]
    sampling = {key: float(value) for key, value in (p.split("=", 1) for p in args.sampling)}
    update: dict[str, Any] = {}
    if sampling:
        update["sampling"] = SamplingOverride.model_validate(
            {**role.sampling.model_dump(), **sampling}
        )
    if args.thinking:
        update["thinking"] = True
    if args.max_tokens:
        update["max_tokens"] = args.max_tokens
    changed = role.model_copy(update=update)
    experiment = {
        "sampling": sampling,
        "thinking": changed.thinking,
        "max_tokens": changed.max_tokens,
        "previous_chars": args.previous_chars or write_context.PREVIOUS_CHARS,
    }
    return config.model_copy(update={"roles": {**config.roles, "write": changed}}), experiment


async def write_chapter(
    router: Router,
    jobs: JobQueue,
    client: RecordingClient,
    conn: Any,
    db_path: Path,
    chapter: dict[str, Any],
) -> dict[str, Any]:
    """The chapter written by the app's chapter job; its calls matched to its beats."""
    client.calls.clear()
    started = time.perf_counter()
    job = jobs.get(writing.start_chapter(router, jobs, db_path, chapter["id"]))
    assert job is not None
    while job.status not in TERMINAL:
        await asyncio.sleep(0.2)
    record: dict[str, Any] = {
        "id": chapter["id"],
        "number": chapter["number"],
        "target_chars": chapter["target_chars"],
        "status": job.status,
        "seconds": round(time.perf_counter() - started, 1),
    }
    by_order: dict[int, list[dict[str, Any]]] = {}
    for call in client.calls:
        by_order.setdefault(call["order"], []).append(call)
    for event in job.events:
        if event.type == "done":
            record["result"] = event.data["result"]
        elif event.type == "error":
            record["error"] = event.data
    texts = chapters_db.current_texts(conn, chapter["id"])
    record["beats"] = [
        {
            **{
                key: beat[key]
                for key in (
                    "id",
                    "order",
                    "scene",
                    "source_stage",
                    "summary",
                    "pov",
                    "mode",
                    "focus",
                    "density",
                    "tension",
                    "target_chars",
                )
            },
            "calls": by_order.get(beat["order"], []),
            "text": texts.get(beat["id"]),
            "chars": (
                write_context.count_chars(texts[beat["id"]]) if beat["id"] in texts else None
            ),
        }
        for beat in chapter["beats"]
    ]
    return record


async def main() -> None:
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--url")
    source.add_argument("--fake", action="store_true", help="fixture client, no model")
    parser.add_argument("--plans", type=Path, required=True, help="a step 4 run's results")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--episodes", nargs="+", metavar="ID", help="only these episode ids")
    parser.add_argument(
        "--sampling",
        nargs="+",
        default=[],
        metavar="KEY=VALUE",
        help="the write role's sampling changed for this run, e.g. dry_multiplier=0.8",
    )
    parser.add_argument("--thinking", action="store_true", help="the write role thinks first")
    parser.add_argument("--max-tokens", type=int, help="the write role's max_tokens")
    parser.add_argument(
        "--previous-chars", type=int, help="how much of the manuscript before a beat it sees"
    )
    args = parser.parse_args()

    plans = json.loads(args.plans.read_text(encoding="utf-8"))["episodes"]
    llama = None if args.fake else LlamaClient(args.url)
    client = RecordingClient(llama or FakeClient())
    config, experiment = configured(args)
    if args.previous_chars:
        write_context.PREVIOUS_CHARS = args.previous_chars
    router = Router(config, client, lora_dir=HERE / "no-lora")
    jobs = JobQueue()
    jobs.start()
    results: dict[str, Any] = {
        "started_at": datetime.now(UTC).isoformat(),
        "fake": args.fake,
        "plans": str(args.plans),
        "prompt": config.roles["write"].prompt,
        **experiment,
        "chapters": [],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    for genre in GENRES:
        planned = [p for p in plans if p["genre"] == genre and p.get("plan")]
        wanted = {p["id"] for p in planned if not args.episodes or p["id"] in args.episodes}
        if not wanted:
            continue
        doc, seeds, _ = load_genre(genre)
        with tempfile.TemporaryDirectory() as tmp:
            conn, work_id = open_cases(Path(tmp), doc, seeds)
            try:
                works.advance(conn, work_id)
                for at, record in enumerate(planned):
                    plans_db.insert(conn, f"pl_{at:016x}", "confirmed", confirmed(record["plan"]))
                works.advance(conn, work_id)
                for chapter in manuscript.chapters(conn, work_id):
                    if chapter.episode_id not in wanted:
                        continue
                    print(f"{chapter.episode_id} chapter {chapter.number}", flush=True)
                    written = await write_chapter(
                        router,
                        jobs,
                        client,
                        conn,
                        Path(tmp) / "aiplot.db",
                        chapter.model_dump(mode="json"),
                    )
                    results["chapters"].append(
                        {"genre": genre, "episode": chapter.episode_id, **written}
                    )
                    write(args.out, results)
            finally:
                conn.close()
    await jobs.stop()
    if llama is not None:
        await llama.aclose()
    results["finished_at"] = datetime.now(UTC).isoformat()
    if write(args.out, results):
        print(f"wrote {args.out}")


if __name__ == "__main__":
    asyncio.run(main())
