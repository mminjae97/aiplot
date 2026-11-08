"""Step 4: the rubric scores of a scoring page (§20 step 4), and agreement between two scorers.

    uv run python eval/step4/score_bundles.py eval/results/step4/run1/key.json \
        eval/results/step4/run1/scores-user-*.json eval/results/step4/run1/scores-claude-*.json \
        --json eval/results/step4/score-run1.json --md eval/results/step4/report-run1.md

Every score file must come from the page of this key (same `page`). Per scorer: the mean of
each item over the bundles it scored, overall and per genre, and which scorable bundles it left
incomplete. With two scorers, per item over the bundles both scored: exact agreement, agreement
within one point, mean absolute difference and quadratic weighted kappa (1 = identical, 0 =
chance). No pass number: the scores are the baseline of the prompt-only direction. A fake run's
key is reported as a FAKE RUN.
"""

import argparse
import json
import sys
from pathlib import Path
from statistics import mean
from typing import Any

HERE = Path(__file__).parent
POINTS = [1, 2, 3, 4, 5]


def kappa(pairs: list[tuple[int, int]]) -> float | None:
    """Quadratic weighted kappa over 1-5 ratings; None without pairs or without spread."""
    if not pairs:
        return None
    n = len(pairs)
    k = len(POINTS)
    observed = [[0.0] * k for _ in range(k)]
    for a, b in pairs:
        observed[a - 1][b - 1] += 1
    rows = [sum(observed[i]) for i in range(k)]
    cols = [sum(observed[i][j] for i in range(k)) for j in range(k)]
    disagreement = expected = 0.0
    for i in range(k):
        for j in range(k):
            weight = (i - j) ** 2 / (k - 1) ** 2
            disagreement += weight * observed[i][j]
            expected += weight * rows[i] * cols[j] / n
    if expected == 0:
        return None
    return 1 - disagreement / expected


def complete(entry: dict[str, Any], items: list[str]) -> bool:
    return all(isinstance(entry.get(item), int) and entry[item] in POINTS for item in items)


def summarize(key: dict[str, Any], files: list[dict[str, Any]], items: list[str]) -> dict[str, Any]:
    bundles: dict[str, Any] = key["bundles"]
    scorable = [n for n, b in bundles.items() if b["scored"]]
    scorers: dict[str, Any] = {}
    for doc in files:
        if doc["page"] != key["page"]:
            raise ValueError(f"{doc['scorer']}: scores of page {doc['page']}, key {key['page']}")
        if doc["scorer"] in scorers:
            raise ValueError(f"two score files for {doc['scorer']}")
        scores = {
            n: entry
            for n, entry in doc["scores"].items()
            if n in scorable and complete(entry, items)
        }
        genres = sorted({bundles[n]["genre"] for n in scores})
        scorers[doc["scorer"]] = {
            "scored": len(scores),
            "missing": [n for n in scorable if n not in scores],
            "mean": {
                item: mean(s[item] for s in scores.values()) if scores else None for item in items
            },
            "by_genre": {
                genre: {
                    item: mean(s[item] for n, s in scores.items() if bundles[n]["genre"] == genre)
                    for item in items
                }
                for genre in genres
            },
            "scores": scores,
        }
    agreement: dict[str, Any] | None = None
    if len(scorers) == 2:
        (name_a, a), (name_b, b) = scorers.items()
        both = sorted(set(a["scores"]) & set(b["scores"]))
        agreement = {"scorers": [name_a, name_b], "bundles": len(both), "items": {}}
        for item in items:
            pairs = [(a["scores"][n][item], b["scores"][n][item]) for n in both]
            agreement["items"][item] = {
                "exact": sum(x == y for x, y in pairs) / len(pairs) if pairs else None,
                "within_1": sum(abs(x - y) <= 1 for x, y in pairs) / len(pairs) if pairs else None,
                "mad": mean(abs(x - y) for x, y in pairs) if pairs else None,
                "kappa": kappa(pairs),
            }
    return {
        "page": key["page"],
        "run": key["run"],
        "fake": bool(key.get("fake")),
        "bundles": len(bundles),
        "scorable": len(scorable),
        "failed": [n for n, b in bundles.items() if not b["scored"]],
        "scorers": scorers,
        "agreement": agreement,
    }


def fmt(value: float | None, digits: int = 2) -> str:
    return "-" if value is None else f"{value:.{digits}f}"


def report(summary: dict[str, Any], key: dict[str, Any], names: dict[str, str]) -> str:
    items = list(names)
    lines = ["# Step 4 direction rubric", ""]
    if summary["fake"]:
        lines += ["**FAKE RUN** (fixture client): a check of the scripts, not a measurement.", ""]
    lines.append(
        f"Page {summary['page']} from `{summary['run']}`: {summary['bundles']} bundles, "
        f"{summary['scorable']} scorable, failed plans: {', '.join(summary['failed']) or 'none'}."
    )
    lines += ["", "## Means (1-5)", ""]
    lines.append("| scorer | bundles | " + " | ".join(names[i] for i in items) + " |")
    lines.append("|---|---|" + "---|" * len(items))
    for name, s in summary["scorers"].items():
        cells = " | ".join(fmt(s["mean"][i]) for i in items)
        lines.append(f"| {name} | {s['scored']} | {cells} |")
    for name, s in summary["scorers"].items():
        if s["missing"]:
            lines.append(f"\n{name} left incomplete: {', '.join(s['missing'])}")
    agreement = summary["agreement"]
    if agreement:
        a, b = agreement["scorers"]
        lines += ["", f"## Agreement ({a} vs {b}, {agreement['bundles']} bundles)", ""]
        lines.append("| item | exact | within 1 | mean abs diff | weighted kappa |")
        lines.append("|---|---|---|---|---|")
        for item in items:
            g = agreement["items"][item]
            lines.append(
                f"| {names[item]} | {fmt(g['exact'])} | {fmt(g['within_1'])} | "
                f"{fmt(g['mad'])} | {fmt(g['kappa'])} |"
            )
    lines += ["", "## By genre", ""]
    for name, s in summary["scorers"].items():
        lines.append(f"### {name}")
        lines.append("| genre | " + " | ".join(names[i] for i in items) + " |")
        lines.append("|---|" + "---|" * len(items))
        for genre, means in s["by_genre"].items():
            lines.append(f"| {genre} | " + " | ".join(fmt(means[i]) for i in items) + " |")
        lines.append("")
    lines += ["## Bundles", ""]
    header = " | ".join(f"{n} {names[i]}" for n in summary["scorers"] for i in items)
    lines.append(f"| bundle | episode | {header} |")
    lines.append("|---|---|" + "---|" * (len(items) * len(summary["scorers"])))
    for n, bundle in key["bundles"].items():
        row: list[str] = []
        for s in summary["scorers"].values():
            entry = s["scores"].get(n)
            row += [str(entry[i]) if entry else "-" for i in items]
        lines.append(f"| {n} | {bundle['episode']} | " + " | ".join(row) + " |")
    notes = [
        (name, n, s["scores"][n].get("note", "").strip())
        for name, s in summary["scorers"].items()
        for n in s["scores"]
    ]
    notes = [note for note in notes if note[2]]
    if notes:
        lines += ["", "## Notes", ""]
        lines += [f"- {n} ({name}): {text}" for name, n, text in notes]
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("key", type=Path)
    parser.add_argument("scores", type=Path, nargs="+")
    parser.add_argument("--json", type=Path)
    parser.add_argument("--md", type=Path)
    args = parser.parse_args()

    key = json.loads(args.key.read_text(encoding="utf-8"))
    rubric = json.loads((HERE / "rubric.json").read_text(encoding="utf-8"))
    names = {item["key"]: item["name"] for item in rubric["items"]}
    files = [json.loads(path.read_text(encoding="utf-8")) for path in args.scores]
    summary = summarize(key, files, list(names))
    text = report(summary, key, names)
    if args.json:
        args.json.write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"wrote {args.json}")
    if args.md:
        args.md.write_text(text, encoding="utf-8")
        print(f"wrote {args.md}")
    if not (args.json or args.md):
        # The Korean item names would not survive a Windows console's default code page.
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
        print(text)


if __name__ == "__main__":
    main()
