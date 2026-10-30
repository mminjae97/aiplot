"""Step 1 unit 5, round 2: emotion vs information beats, style framework v1 vs v2, Q4 vs Q5.

Round 1 suggested Q5 wins emotional scenes and Q4 wins plain summaries. Each profile writes
every cases_round2.json beat with style v1 and v2 (presence_penalty 1.5, the round 1 winner),
and retries the Q5-breaking region chat with presence 1.5. With llama-server started by hand:
    uv run python eval/unit5/round2.py run --url http://127.0.0.1:8796 \
        --profile qwen3-8b-uncensor-q4km --out eval/results/round2-qwen3-8b-uncensor-q4km.json
    uv run python eval/unit5/round2.py pairs LEFT.json:v2 RIGHT.json:v2 --out eval/results/r2-model
    uv run python eval/unit5/round2.py votes eval/results/r2-model/blind-key.json VOTES.json
"""

import argparse
import asyncio
import json
import random
from pathlib import Path
from typing import Any

from aiplot.llm.client import LlamaClient, Message
from aiplot.llm.router import Router
from measure import (
    HERE,
    STYLE_FILE,
    WRITE_SAMPLING,
    beat_instruction,
    block,
    measure_config,
    run_stream,
    style_system_prompt,
    write_request,
)
from report import SEED, shown
from sampling import repetition

STYLES = {"v1": STYLE_FILE, "v2": STYLE_FILE.with_name("webnovel-style-v2.md")}
SAMPLING = WRITE_SAMPLING.model_copy(update={"presence_penalty": 1.5})
CHAT_RETRIES = 3


def load(path: Path) -> dict[str, Any]:
    data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return data


async def run(args: argparse.Namespace) -> None:
    beats = load(HERE / "cases_round2.json")["writing"]
    client = LlamaClient(args.url)
    router = Router(measure_config(args.profile), client, lora_dir=HERE / "no-lora")
    results: dict[str, Any] = {"profile": args.profile, "writing": [], "region_chat": []}
    for style, path in STYLES.items():
        for beat in beats:
            print(f"{style} {beat['id']}", flush=True)
            system = style_system_prompt(path, beat)
            out = await run_stream(
                client, write_request(router, system, beat_instruction(beat), SAMPLING)
            )
            ratio = round(out["chars"] / beat["target_chars"], 2)
            results["writing"].append(
                {"style": style, "id": beat["id"], "focus": beat["focus"], "ratio": ratio}
                | out
                | repetition(out["text"])
            )
    region = next(c for c in load(HERE / "cases.json")["cards"] if c["id"] == "region-kallis")
    context = "\n".join(
        [
            block("원문", region["notes"]),
            block("참고 카드", "\n".join(region["refs"])),
            block("지시", f"카드 종류: 지역. 정해지지 않은 항목: {region['missing']}"),
        ]
    )
    turns: list[Message] = [{"role": "user", "content": f"{context}\n\n{region['chat_user']}"}]
    for attempt in range(CHAT_RETRIES):
        print(f"region chat presence #{attempt + 1}", flush=True)
        request = router.request("chat", turns)
        sampling = request.sampling.model_copy(update={"presence_penalty": 1.5})
        request = type(request)(**{**request.__dict__, "sampling": sampling, "max_tokens": 1024})
        results["region_chat"].append(await run_stream(client, request))
    await client.aclose()
    args.out.write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {args.out}")


def side(spec: str) -> tuple[dict[str, Any], str]:
    path, style = spec.rsplit(":", 1)
    return load(Path(path)), style


def pairs(left_spec: str, right_spec: str, out: Path) -> None:
    left, left_style = side(left_spec)
    right, right_style = side(right_spec)
    beats = {b["id"]: b for b in load(HERE / "cases_round2.json")["writing"]}
    right_rows = {w["id"]: w for w in right["writing"] if w["style"] == right_style}
    rng = random.Random(SEED + 2)
    page, key = [], {}
    for w in (w for w in left["writing"] if w["style"] == left_style):
        beat = beats[w["id"]]
        sides = [
            (f"{left['profile']}:{left_style}", w["text"]),
            (f"{right['profile']}:{right_style}", right_rows[w["id"]]["text"]),
        ]
        rng.shuffle(sides)
        key[w["id"]] = [name for name, _ in sides]
        kind = "감정 장면" if beat["focus"] == "감정" else "정보 비트"
        page.append(
            {
                "id": w["id"],
                "title": f"{kind[:2]} {w['id'][1:]}",
                "kind": kind,
                "brief": (
                    f"{beat['genre']} · {beat['scene']} · {beat['pov']} · {beat['mode']}"
                    f" · 긴장도 {beat['tension']} · 목표 {beat['target_chars']}자\n"
                    f"{beat['instruction']}"
                ),
                "texts": [shown(text) for _, text in sides],
            }
        )
    template = (HERE / "blind_template.html").read_text(encoding="utf-8")
    data = json.dumps(page, ensure_ascii=False).replace("</", "<\\/")
    out.mkdir(parents=True, exist_ok=True)
    (out / "blind.html").write_text(template.replace("__PAIRS__", data), encoding="utf-8")
    (out / "blind-key.json").write_text(json.dumps(key, indent=1), encoding="utf-8")
    print(f"{len(page)} pairs -> {out / 'blind.html'}")


def votes(key_path: Path, votes_path: Path) -> None:
    key, raw = load(key_path), load(votes_path)
    beats = {b["id"]: b for b in load(HERE / "cases_round2.json")["writing"]}
    tally: dict[str, dict[str, int]] = {}
    for pair_id, vote in raw.items():
        winner = "tie" if vote["choice"] == "tie" else key[pair_id][int(vote["choice"]) - 1]
        focus = beats[pair_id]["focus"]
        for group in ("all", focus):
            tally.setdefault(group, {})
            tally[group][winner] = tally[group].get(winner, 0) + 1
    print(f"votes: {len(raw)}/{len(key)}")
    for group, counts in tally.items():
        print(f"{group}: {counts}")


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    r = sub.add_parser("run")
    r.add_argument("--url", required=True)
    r.add_argument("--profile", required=True)
    r.add_argument("--out", type=Path, required=True)
    p = sub.add_parser("pairs")
    p.add_argument("left", help="results.json:style")
    p.add_argument("right", help="results.json:style")
    p.add_argument("--out", type=Path, required=True)
    v = sub.add_parser("votes")
    v.add_argument("key", type=Path)
    v.add_argument("votes", type=Path)
    args = parser.parse_args()
    if args.command == "run":
        asyncio.run(run(args))
    elif args.command == "pairs":
        pairs(args.left, args.right, args.out)
    else:
        votes(args.key, args.votes)


if __name__ == "__main__":
    main()
