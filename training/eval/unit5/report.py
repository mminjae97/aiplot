"""Step 1 unit 5: blind pairs and summaries from two measure.py result files.

uv run python eval/unit5/report.py pairs A.json B.json --out eval/results/blind
    writes blind.html (the page to publish) and blind-key.json (which side is which; local only)
uv run python eval/unit5/report.py metrics A.json [B.json ...]
    prints time, token usage, truncation, schema validity and refusal counts per profile
uv run python eval/unit5/report.py votes eval/results/blind/blind-key.json VOTES.json
    prints blind-comparison wins per profile from the page's saved votes
"""

import argparse
import json
import random
import statistics
from pathlib import Path
from typing import Any

HERE = Path(__file__).parent
SEED = 20261030
# Degenerate replies (a token loop up to max_tokens) stay in the comparison, shortened for reading.
SHOWN_CHARS = 1500


def load(path: Path) -> dict[str, Any]:
    data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return data


def writing_from(path: Path, variant: str) -> list[dict[str, Any]]:
    """First sample of one sampling.py variant, shaped like measure.py writing rows."""
    rows = load(path)["writing"]
    return [w for w in rows if w["variant"] == variant and w["sample"] == 0]


def shown(text: str) -> str:
    if len(text) <= SHOWN_CHARS:
        return text
    return f"{text[:SHOWN_CHARS]}\n\n[이하 생략 · 전체 {len(text)}자]"


def pairs(
    a_path: Path,
    b_path: Path,
    out: Path,
    sampling: list[Path] | None = None,
    variant: str | None = None,
) -> None:
    a, b = load(a_path), load(b_path)
    if sampling and variant:
        a["writing"] = writing_from(sampling[0], variant)
        b["writing"] = writing_from(sampling[1], variant)
    cases = load(HERE / "cases.json")
    beats = {beat["id"]: beat for beat in cases["writing"]}
    cards = {case["id"]: case for case in cases["cards"]}
    items: list[dict[str, Any]] = []
    b_writing = {w["id"]: w for w in b["writing"]}
    for w in a["writing"]:
        beat = beats[w["id"]]
        brief = (
            f"{beat['genre']} · {beat['scene']} · {beat['pov']} · {beat['mode']}"
            f" · 긴장도 {beat['tension']} · 목표 {beat['target_chars']}자\n{beat['instruction']}"
        )
        items.append(
            {
                "id": w["id"],
                "title": f"글 {w['id'][1:]}",
                "kind": "글쓰기 비트",
                "brief": brief,
                "sides": [(a["profile"], w["text"]), (b["profile"], b_writing[w["id"]]["text"])],
            }
        )
    b_chat = {(c["id"], c["repeat"]): c for c in b["cards"]}
    for c in a["cards"]:
        if c["repeat"] != 0:
            continue
        case = cards[c["id"]]
        brief = f"원문:\n{case['notes']}\n\n작가: {case['chat_user']}"
        items.append(
            {
                "id": f"chat-{c['id']}",
                "title": f"대화 {c['type']}",
                "kind": "chat 답변",
                "brief": brief,
                "sides": [
                    (a["profile"], c["chat"]["text"]),
                    (b["profile"], b_chat[(c["id"], 0)]["chat"]["text"]),
                ],
            }
        )
    rng = random.Random(SEED)
    page_pairs = []
    key = {}
    for item in items:
        sides = list(item.pop("sides"))
        rng.shuffle(sides)
        key[item["id"]] = [profile for profile, _ in sides]
        page_pairs.append({**item, "texts": [shown(text) for _, text in sides]})
    template = (HERE / "blind_template.html").read_text(encoding="utf-8")
    data = json.dumps(page_pairs, ensure_ascii=False).replace("</", "<\\/")
    out.mkdir(parents=True, exist_ok=True)
    (out / "blind.html").write_text(template.replace("__PAIRS__", data), encoding="utf-8")
    (out / "blind-key.json").write_text(json.dumps(key, indent=1), encoding="utf-8")
    print(f"{len(page_pairs)} pairs -> {out / 'blind.html'}")


def stats(values: list[float]) -> str:
    if not values:
        return "-"
    return f"median {statistics.median(values):g} / max {max(values):g} (n={len(values)})"


def metrics(paths: list[Path]) -> None:
    for path in paths:
        r = load(path)
        print(f"== {r['profile']}")
        t = r["template"]
        print(
            "template: enable_thinking in template =",
            t["template_mentions_enable_thinking"],
            "| reasoning chars off/on =",
            t["thinking_off"]["reasoning_chars"],
            "/",
            t["thinking_on"]["reasoning_chars"],
        )
        print("system prompt tokens:", r["system_prompt_tokens"])
        chat = [c["chat"] for c in r["cards"]]
        first = [c["first_content_s"] for c in chat if c["first_content_s"]]
        print("chat first content s:", stats(first))
        for role in ("source", "card"):
            runs = [c[role] for c in r["cards"]]
            ok = [x for x in runs if "value" in x]
            errors = [x["error"] for x in runs if "error" in x]
            used = [x["usage"] for x in ok if x["usage"]]
            print(f"{role}: valid {len(ok)}/{len(runs)} errors={errors}")
            print(f"  total s: {stats([x['total_s'] for x in ok])}")
            print(f"  completion tokens: {stats([u['completion_tokens'] for u in used])}")
            print(f"  prompt tokens: {stats([u['prompt_tokens'] for u in used])}")
            print(f"  reasoning chars: {stats([x['reasoning_chars'] for x in ok])}")
        refused = [x["id"] for x in r["refusals"] if x["refused_guess"]]
        print(f"refusals flagged: {len(refused)}/{len(r['refusals'])} {refused}")
        w = r["writing"]
        cases = {beat["id"]: beat for beat in load(HERE / "cases.json")["writing"]}
        ratios = [x["chars"] / cases[x["id"]]["target_chars"] for x in w]
        print(f"writing chars/target: {stats([round(v, 2) for v in ratios])}")
        print(f"writing finish: {[x['finish'] for x in w]}")
        print(f"writing total s: {stats([x['total_s'] for x in w])}")


def votes(key_path: Path, votes_path: Path) -> None:
    key = load(key_path)
    raw = load(votes_path)
    tally: dict[str, int] = {}
    by_kind: dict[str, dict[str, int]] = {}
    for pair_id, vote in raw.items():
        sides = key[pair_id]
        winner = "tie" if vote["choice"] == "tie" else sides[int(vote["choice"]) - 1]
        kind = "chat" if pair_id.startswith("chat-") else "writing"
        tally[winner] = tally.get(winner, 0) + 1
        by_kind.setdefault(kind, {})[winner] = by_kind.setdefault(kind, {}).get(winner, 0) + 1
    print(f"votes: {len(raw)}/{len(key)}")
    print("overall:", tally)
    for kind, counts in by_kind.items():
        print(f"{kind}:", counts)


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("pairs")
    p.add_argument("a", type=Path)
    p.add_argument("b", type=Path)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--sampling", type=Path, nargs=2, help="sampling.py results for a and b")
    p.add_argument("--variant", help="writing variant to take from --sampling")
    m = sub.add_parser("metrics")
    m.add_argument("paths", type=Path, nargs="+")
    v = sub.add_parser("votes")
    v.add_argument("key", type=Path)
    v.add_argument("votes", type=Path)
    args = parser.parse_args()
    if args.command == "pairs":
        pairs(args.a, args.b, args.out, args.sampling, args.variant)
    elif args.command == "metrics":
        metrics(args.paths)
    else:
        votes(args.key, args.votes)


if __name__ == "__main__":
    main()
