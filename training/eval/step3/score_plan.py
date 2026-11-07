"""Step 3: scores a run_plan.py result (§20 step 3).

    uv run python eval/step3/score_plan.py eval/results/step3/run1.json \
        --json eval/results/step3/score-run1.json --md eval/results/step3/report-run1.md

Pass criterion: schema pass >=95% for each role's calls (`arrange` per episode, `direct` per
scene). A call passes when it returns a cleaned result: valid JSON for the narrowed schema after
the router's one retry, and anything left after cleaning within its one more generation (§13).
A call that failed for another reason (no model, a refused scene) is counted apart and never
passes. Episodes whose scene call failed make no arrange or direct call, and scenes with no
recommended card (so nothing chosen) no direct call; both are listed.

Recorded, no criterion (material for step 4's rubric): first-try passes, times and tokens;
chapters per episode and beats per chapter (§1: 6-10); episodes told out of story order; the
chosen card named by a beat; 전회 연결 도입 named in a chapter's first scene and 회차 끝 절단
in its last scene's last beat; point-of-view changes within a scene. A --fake run is a FAKE RUN,
a run missing case episodes a PARTIAL RUN, one without finished_at an UNFINISHED RUN; only a run
that is none of these can pass.
"""

import argparse
import json
import statistics
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent / "unit15"))
sys.path.insert(0, str(HERE.parent / "step2"))

from aiplot.services import direction, techniques  # noqa: E402
from check import GENRES, load  # noqa: E402

TARGET = 0.95
CTX = 12288
CATALOG = {card.id: card for card in techniques.load()}
# Codes of a call that never reached a usable model reply for its own output's sake.
OUTPUT_FAILURES = {"LLM_INVALID_OUTPUT", "LLM_OUTPUT_TRUNCATED"}


def stats(values: list[float]) -> dict[str, float] | None:
    if not values:
        return None
    return {
        "n": len(values),
        "mean": round(statistics.mean(values), 1),
        "median": round(statistics.median(values), 1),
        "max": round(max(values), 1),
    }


def role_score(calls: list[dict[str, Any]]) -> dict[str, Any]:
    """Schema pass over the calls whose reply was judged (passed, or failed on its output);
    other failures (request errors, refusals) listed apart."""
    passed = [c for c in calls if "error" not in c]
    invalid = [c for c in calls if c.get("error") in OUTPUT_FAILURES]
    other: dict[str, int] = {}
    for call in calls:
        code = call.get("error")
        if code is not None and code not in OUTPUT_FAILURES:
            other[code] = other.get(code, 0) + 1
    judged = len(passed) + len(invalid)
    used = [c["usage"] for c in passed if c.get("usage")]
    return {
        "calls": len(calls),
        "judged": judged,
        "passed": len(passed),
        "rate": round(len(passed) / judged, 3) if judged else None,
        "first_try": sum(1 for c in passed if c.get("generations", 1) == 1),
        "invalid": {
            code: sum(1 for c in invalid if c["error"] == code) for code in OUTPUT_FAILURES
        },
        "other_failures": other,
        "time_s": stats([c["total_s"] for c in passed]),
        "prompt_tokens": stats([u["prompt_tokens"] for u in used]),
        "completion_tokens": stats([u["completion_tokens"] for u in used]),
        "max_total_tokens": max(
            (u["prompt_tokens"] + u["completion_tokens"] for u in used), default=None
        ),
        "ctx": CTX,
    }


def plan_traits(plan: dict[str, Any]) -> dict[str, Any]:
    """What a plan did with its chapters, cards and points of view (recorded only)."""
    chapters = plan["chapters"]
    order = [s["scene"] for c in chapters for s in c["scenes"]]
    directed = [
        (direction.place_of(i, len(c["scenes"])), s)
        for c in chapters
        for i, s in enumerate(c["scenes"])
        if s["beats"]
    ]
    named = [
        bool(set(s["chosen"]) & {t for b in s["beats"] for t in b["techniques"]})
        for _, s in directed
        if s["chosen"]
    ]
    opening = [
        any(direction.OPENING_SERIAL in b["techniques"] for b in s["beats"])
        for place, s in directed
        if place in ("first", "only")
    ]
    cut = [
        direction.CUT_SERIAL in s["beats"][-1]["techniques"]
        for place, s in directed
        if place in ("last", "only")
    ]
    pov_changes = [len({b["pov"] for b in s["beats"]}) > 1 for _, s in directed]
    return {
        "chapters": len(chapters),
        "scenes_per_chapter": [len(c["scenes"]) for c in chapters],
        "reordered": order != sorted(order),
        "beats_per_chapter": [sum(len(s["beats"]) for s in c["scenes"]) for c in chapters],
        "complete": all(s["beats"] for c in chapters for s in c["scenes"]),
        "chosen_named": named,
        "opening_named": opening,
        "cut_named": cut,
        "pov_changes": pov_changes,
    }


def count(flags: list[bool]) -> str:
    return f"{sum(flags)}/{len(flags)}"


def score(run: dict[str, Any]) -> dict[str, Any]:
    episodes = run["episodes"]
    expected = {e["id"] for genre in GENRES for e in load(genre)[0]["episodes"]}
    present = {e["id"] for e in episodes}
    arrange_calls = [e["arrange_call"] for e in episodes if "arrange_call" in e]
    direct_all = [c for e in episodes for c in e.get("direct_calls", [])]
    direct_calls = [c for c in direct_all if "skipped" not in c]
    traits = {e["id"]: plan_traits(e["plan"]) for e in episodes if "plan" in e}
    flags = {
        "fake": bool(run.get("fake")),
        "partial": sorted(expected - present),
        "unfinished": "finished_at" not in run,
    }
    roles = {"arrange": role_score(arrange_calls), "direct": role_score(direct_calls)}
    passing = (
        not (flags["fake"] or flags["partial"] or flags["unfinished"])
        and all(r["rate"] is not None and r["rate"] >= TARGET for r in roles.values())
        and not any(r["other_failures"] for r in roles.values())
    )
    every = list(traits.values())
    return {
        "flags": flags,
        "target": TARGET,
        "pass": passing,
        "roles": roles,
        "scene_failures": [e["id"] for e in episodes if "error" in e["scene_call"]],
        "skipped_scenes": [
            f"{e['id']} scene {c['scene']}"
            for e in episodes
            for c in e.get("direct_calls", [])
            if "skipped" in c
        ],
        "summary": {
            "plans": len(every),
            "complete_plans": sum(t["complete"] for t in every),
            "chapters": stats([t["chapters"] for t in every]),
            "beats_per_chapter": stats([n for t in every for n in t["beats_per_chapter"]]),
            "chapters_with_6_to_10_beats": count(
                [6 <= n <= 10 for t in every for n in t["beats_per_chapter"]]
            ),
            "reordered_episodes": count([t["reordered"] for t in every]),
            "chosen_named": count([f for t in every for f in t["chosen_named"]]),
            "opening_named": count([f for t in every for f in t["opening_named"]]),
            "cut_named": count([f for t in every for f in t["cut_named"]]),
            "pov_changes": count([f for t in every for f in t["pov_changes"]]),
        },
        "episodes": traits,
    }


def card_name(technique_id: str) -> str:
    card = CATALOG.get(technique_id)
    return f"{card.name} ({technique_id})" if card else technique_id


def report(run: dict[str, Any], scored: dict[str, Any]) -> str:
    flags = scored["flags"]
    labels = [
        label
        for label, on in (
            ("FAKE RUN", flags["fake"]),
            ("PARTIAL RUN", flags["partial"]),
            ("UNFINISHED RUN", flags["unfinished"]),
        )
        if on
    ]
    lines = [f"# Step 3 run {' · '.join(labels)}".rstrip(), ""]
    verdict = "PASS" if scored["pass"] else "FAIL"
    lines.append(f"**{verdict}** (schema pass ≥{scored['target']:.0%} per role)")
    lines.append("")
    lines.append(
        "| role | calls | passed / judged | first try | invalid | other | time median/max s |"
    )
    lines.append("|---|---|---|---|---|---|---|")
    for role, r in scored["roles"].items():
        time_s = r["time_s"] or {}
        lines.append(
            f"| {role} | {r['calls']} | {r['passed']}/{r['judged']} | {r['first_try']} | "
            f"{sum(r['invalid'].values())} | {sum(r['other_failures'].values())} | "
            f"{time_s.get('median', '-')}/{time_s.get('max', '-')} |"
        )
    lines.append("")
    if scored["scene_failures"]:
        lines.append(f"Scene call failed (no plan): {', '.join(scored['scene_failures'])}")
        lines.append("")
    if scored["skipped_scenes"]:
        lines.append(f"No recommended card (not directed): {', '.join(scored['skipped_scenes'])}")
        lines.append("")
    lines.append("## Recorded")
    lines.append("")
    for key, value in scored["summary"].items():
        lines.append(f"- {key}: {value}")
    for role, r in scored["roles"].items():
        lines.append(
            f"- {role} tokens: prompt {r['prompt_tokens']}, completion {r['completion_tokens']}, "
            f"max total {r['max_total_tokens']} / {r['ctx']}"
        )
    lines.append("")
    lines.append("## Plans")
    for episode in run["episodes"]:
        lines.append("")
        lines.append(f"### {episode['id']} {episode['name']}")
        if "plan" not in episode:
            call = episode.get("arrange_call") or episode["scene_call"]
            lines.append(f"- no plan: {call.get('error')} {call.get('message', '')}")
            continue
        failed = {c["scene"]: c for c in episode["direct_calls"] if "error" in c}
        for chapter in episode["plan"]["chapters"]:
            lines.append(f"- **{chapter['chapter']}화**")
            for scene in chapter["scenes"]:
                chosen = ", ".join(card_name(t) for t in scene["chosen"]) or "없음"
                lines.append(
                    f"  - 장면 {scene['scene']} ({scene['source']}, {scene['target_chars']}자, "
                    f"카드: {chosen}) {scene['summary']}"
                )
                for text in scene["reveal"]:
                    lines.append(f"    - 드러냄: {text}")
                if scene["scene"] in failed:
                    call = failed[scene["scene"]]
                    lines.append(f"    - direct 실패: {call['error']} {call['message']}")
                for beat in scene["beats"]:
                    names = ", ".join(card_name(t) for t in beat["techniques"])
                    lines.append(
                        f"    {beat['order']}. [{beat['pov']} · {beat['mode']}·{beat['focus']}·"
                        f"{beat['density']} · 긴장 {beat['tension']} · {beat['target_chars']}자]"
                        f" {beat['summary']}" + (f" ({names})" if names else "")
                    )
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("run", type=Path)
    parser.add_argument("--json", type=Path)
    parser.add_argument("--md", type=Path)
    args = parser.parse_args()
    run = json.loads(args.run.read_text(encoding="utf-8"))
    scored = score(run)
    if args.json:
        args.json.write_text(json.dumps(scored, ensure_ascii=False, indent=1), encoding="utf-8")
    if args.md:
        args.md.write_text(report(run, scored), encoding="utf-8")
    roles = scored["roles"]
    print(
        ("PASS" if scored["pass"] else "FAIL")
        + "".join(f" {role} {r['passed']}/{r['judged']}" for role, r in roles.items())
    )


if __name__ == "__main__":
    main()
