"""Step 7: what a run_write.py run measured (§20 step 7).

    uv run python eval/step7/score_write.py eval/results/step7/run1.json [--out score.json]

Length: a chapter passes when its stored characters (incl. spaces, line breaks not counted) are
within ±10% of its target; the criterion is >=90% of the chapters. Beats: stored characters
against the target the call was given (the adjusted one) and against the plan's, and how many
fall in 500-1000. Calls: beats written again, texts cut at max_tokens, empty texts, beats kept
with a banned phrase. Repetition: per chapter, the distinct runs of three eojeol (punctuation
at their edges dropped) that occur twice or more; the criterion is <=3 per chapter. Tokens and
seconds per call.
"""

import argparse
import json
import re
import statistics
from collections import Counter
from pathlib import Path
from typing import Any

TOLERANCE = 0.1
BEAT_RANGE = (500, 1000)
REPEATS_ALLOWED = 3
EDGES = re.compile(r"^\W+|\W+$")


def repeated_runs(text: str, size: int = 3) -> list[str]:
    """The distinct runs of `size` eojeol that occur twice or more in the text."""
    words = [word for word in (EDGES.sub("", piece) for piece in text.split()) if word]
    runs = Counter(" ".join(words[at : at + size]) for at in range(len(words) - size + 1))
    return [run for run, count in runs.items() if count > 1]


def spread(values: list[float]) -> dict[str, float] | None:
    if not values:
        return None
    ordered = sorted(values)
    return {
        "min": round(ordered[0], 2),
        "median": round(statistics.median(ordered), 2),
        "max": round(ordered[-1], 2),
    }


def score(results: dict[str, Any]) -> dict[str, Any]:
    chapters = results["chapters"]
    rows = []
    for chapter in chapters:
        beats = chapter["beats"]
        chars = sum(beat["chars"] or 0 for beat in beats)
        text = "\n".join(beat["text"] or "" for beat in beats)
        ratio = chars / chapter["target_chars"]
        repeats = repeated_runs(text)
        rows.append(
            {
                "genre": chapter["genre"],
                "episode": chapter["episode"],
                "number": chapter["number"],
                "status": chapter["status"],
                "error": (chapter.get("error") or {}).get("code"),
                "beats": len(beats),
                "written": sum(1 for beat in beats if beat["text"]),
                "chars": chars,
                "ratio": round(ratio, 3),
                "in_length": chapter["status"] == "done" and abs(ratio - 1) <= TOLERANCE,
                "repeats": len(repeats),
                "repeated": repeats[:10],
                "seconds": chapter["seconds"],
            }
        )
    written = [beat for chapter in chapters for beat in chapter["beats"] if beat["text"]]
    calls = [call for chapter in chapters for beat in chapter["beats"] for call in beat["calls"]]
    used = [call["usage"] for call in calls if call["usage"]]
    by_kind: dict[str, list[float]] = {}
    for beat in written:
        given = beat["calls"][-1]["target"] if beat["calls"] else beat["target_chars"]
        for key in (f"mode {beat['mode']}", f"focus {beat['focus']}", f"density {beat['density']}"):
            by_kind.setdefault(key, []).append(beat["chars"] / given)
    done = [row for row in rows if row["status"] == "done"]
    return {
        "chapters": len(rows),
        "chapters_done": len(done),
        "chapters_in_length": sum(1 for row in rows if row["in_length"]),
        "chapter_ratio": spread([row["ratio"] for row in done]),
        "chapters_within_repeats": sum(1 for row in done if row["repeats"] <= REPEATS_ALLOWED),
        "chapter_repeats": spread([float(row["repeats"]) for row in done]),
        "beats": sum(row["beats"] for row in rows),
        "beats_written": len(written),
        "beats_in_range": sum(
            1 for beat in written if BEAT_RANGE[0] <= beat["chars"] <= BEAT_RANGE[1]
        ),
        "beat_chars": spread([float(beat["chars"]) for beat in written]),
        "beat_to_given_target": spread(
            [beat["chars"] / beat["calls"][-1]["target"] for beat in written if beat["calls"]]
        ),
        "beat_to_plan_target": spread([beat["chars"] / beat["target_chars"] for beat in written]),
        "beat_to_given_by_kind": {key: spread(values) for key, values in sorted(by_kind.items())},
        "calls": len(calls),
        "beats_written_again": sum(1 for beat in written if len(beat["calls"]) > 1),
        "calls_cut_at_max_tokens": sum(1 for call in calls if call["finish"] == "length"),
        "calls_empty": sum(1 for call in calls if not call["text"].strip()),
        "beats_kept_with_banned": sum(
            (chapter.get("result") or {}).get("warnings", 0) for chapter in chapters
        ),
        "prompt_tokens": spread([float(u["prompt_tokens"]) for u in used]),
        "cached_tokens": spread([float(u["cached_tokens"]) for u in used]),
        "completion_tokens": spread([float(u["completion_tokens"]) for u in used]),
        "total_tokens": spread([float(u["prompt_tokens"] + u["completion_tokens"]) for u in used]),
        "call_seconds": spread([call["seconds"] for call in calls]),
        "chapter_seconds": spread([row["seconds"] for row in done]),
        "rows": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("results", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    scored = score(json.loads(args.results.read_text(encoding="utf-8")))
    for row in scored["rows"]:
        mark = "ok " if row["in_length"] else "-- "
        print(
            f"{mark}{row['episode']} ch{row['number']}: {row['chars']}자 ({row['ratio']:.0%}), "
            f"beats {row['written']}/{row['beats']}, repeats {row['repeats']}, "
            f"{row['seconds']}s {row['error'] or ''}"
        )
    summary = {key: value for key, value in scored.items() if key != "rows"}
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    if args.out:
        args.out.write_text(json.dumps(scored, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
