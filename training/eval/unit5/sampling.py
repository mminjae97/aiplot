"""Step 1 unit 5: repetition-control sampling variants for prose beats and the source role.

measure.py found long sentence loops in prose on both quants and a source thinking loop on
Q5. With llama-server started by hand on the profile's GGUF:
    uv run python eval/unit5/sampling.py run --url http://127.0.0.1:8796 \
        --profile qwen3-8b-uncensor-q4km --base eval/results/unit5-qwen3-8b-uncensor-q4km.json \
        --out eval/results/sampling-qwen3-8b-uncensor-q4km.json
    uv run python eval/unit5/sampling.py report eval/results/sampling-*.json
"""

import argparse
import asyncio
import json
import re
import statistics
from collections import Counter
from pathlib import Path
from typing import Any

from aiplot.generated.roles.source_output import SourceOutput
from aiplot.llm.client import LlamaClient, Message
from aiplot.llm.config import LlmConfig, Sampling
from aiplot.llm.router import Router
from measure import (
    HERE,
    TYPE_NAMES,
    WRITE_SAMPLING,
    beat_instruction,
    block,
    measure_config,
    run_json,
    run_stream,
    style_system_prompt,
    write_request,
)

SAMPLES = 2
WRITE_VARIANTS: dict[str, Sampling] = {
    "base": WRITE_SAMPLING,
    "presence1.5": WRITE_SAMPLING.model_copy(update={"presence_penalty": 1.5}),
    "dry0.8": WRITE_SAMPLING.model_copy(update={"dry_multiplier": 0.8}),
    "both": WRITE_SAMPLING.model_copy(update={"presence_penalty": 1.5, "dry_multiplier": 0.8}),
}
SOURCE_PRESENCE = 1.5
SENTENCE_END = re.compile(r"(?<=[.!?…])\s+|\n+")


def repetition(text: str) -> dict[str, Any]:
    """Code-side counts (never the model's): repeated sentences and repeated 3-eojeol runs."""
    sentences = [s.strip() for s in SENTENCE_END.split(text) if len(s.strip()) >= 4]
    sentence_counts = Counter(sentences)
    words = text.split()
    trigrams = Counter(tuple(words[i : i + 3]) for i in range(len(words) - 2))
    return {
        "repeated_sentences": sum(c - 1 for c in sentence_counts.values() if c > 1),
        "repeated_3eojeol": sum(c - 1 for c in trigrams.values() if c > 1),
        "loop": any(c >= 3 for c in sentence_counts.values()),
    }


def with_source_presence(config: LlmConfig) -> LlmConfig:
    roles = dict(config.roles)
    source = roles["source"]
    sampling = source.sampling.model_copy(update={"presence_penalty": SOURCE_PRESENCE})
    roles["source"] = source.model_copy(update={"sampling": sampling})
    return LlmConfig(profiles=config.profiles, roles=roles)


async def run(args: argparse.Namespace) -> None:
    cases = json.loads((HERE / "cases.json").read_text(encoding="utf-8"))
    base = json.loads(args.base.read_text(encoding="utf-8"))
    client = LlamaClient(args.url)
    router = Router(measure_config(args.profile), client, lora_dir=HERE / "no-lora")
    system = style_system_prompt()
    results: dict[str, Any] = {"profile": args.profile, "writing": [], "source": []}
    for name, sampling in WRITE_VARIANTS.items():
        for sample in range(SAMPLES):
            for beat in cases["writing"]:
                print(f"{name} #{sample + 1} {beat['id']}", flush=True)
                request = write_request(router, system, beat_instruction(beat), sampling)
                out = await run_stream(client, request)
                ratio = round(out["chars"] / beat["target_chars"], 2)
                results["writing"].append(
                    {"variant": name, "sample": sample, "id": beat["id"], "ratio": ratio}
                    | out
                    | repetition(out["text"])
                )
    source_router = Router(
        with_source_presence(measure_config(args.profile)), client, lora_dir=HERE / "no-lora"
    )
    chats = {c["id"]: c["chat"]["text"] for c in base["cards"] if c["repeat"] == 0}
    for case in cases["cards"]:
        print(f"source presence {case['id']}", flush=True)
        turn = "\n".join(
            [
                block("원문", case["notes"]),
                block("참고 카드", "\n".join(case["refs"])),
                block("지시", f"카드 종류: {TYPE_NAMES[case['type']]}"),
                block("대화", f"사용자: {case['chat_user']}\nAI: {chats[case['id']]}"),
            ]
        )
        turns: list[Message] = [{"role": "user", "content": turn}]
        results["source"].append(
            {"id": case["id"], **await run_json(source_router, "source", turns, SourceOutput)}
        )
    await client.aclose()
    args.out.write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {args.out}")


def report(paths: list[Path]) -> None:
    for path in paths:
        r = json.loads(path.read_text(encoding="utf-8"))
        print(f"== {r['profile']}")
        for name in WRITE_VARIANTS:
            rows = [w for w in r["writing"] if w["variant"] == name]
            loops = sum(w["loop"] for w in rows)
            cut = sum(w["finish"] == "length" for w in rows)
            sentences = sum(w["repeated_sentences"] for w in rows)
            trigrams = statistics.median(w["repeated_3eojeol"] for w in rows)
            ratio = statistics.median(w["ratio"] for w in rows)
            print(
                f"{name:12} loops {loops}/{len(rows)}  cut {cut}  repeated sentences {sentences}"
                f"  repeated 3-eojeol median {trigrams}  length/target median {ratio}"
            )
        src = r["source"]
        errors = [s.get("error") for s in src if "error" in s]
        times = [s["total_s"] for s in src if "value" in s]
        print(
            f"source presence {SOURCE_PRESENCE}: valid {len(src) - len(errors)}/{len(src)}"
            f" errors={errors} median s={statistics.median(times) if times else '-'}"
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    r = sub.add_parser("run")
    r.add_argument("--url", required=True)
    r.add_argument("--profile", required=True)
    r.add_argument("--base", type=Path, required=True)
    r.add_argument("--out", type=Path, required=True)
    p = sub.add_parser("report")
    p.add_argument("paths", type=Path, nargs="+")
    args = parser.parse_args()
    if args.command == "run":
        asyncio.run(run(args))
    else:
        report(args.paths)


if __name__ == "__main__":
    main()
