"""Step 2: scores a run_direction.py result against the cases' gold (§20 step 2).

    uv run python eval/step2/score_direction.py eval/results/step2/run1.json \
        --json eval/results/step2/score-run1.json --md eval/results/step2/report-run1.md

Per scored stage (README Scoring): its scenes are those whose source is that stage; none (the
scene call failed or gave the stage no scene) = a miss on both counts.
- Candidates: right if an accepted technique is among the narrowed candidates of any of them.
- Recommendations: right if an accepted technique is in a recommended combination of any of
  them, and every one of them that got a single combination has one in it. A scene whose pick
  call failed recommends nothing.

Also reported: the pick reasons' style (해요체: every sentence ends in 요; ids written out;
a single-technique combination whose reason speaks of combining, e.g. 함께, 합쳐), call failures,
retries, times and token counts against the context size. A run missing a case episode is a
PARTIAL RUN (scored over the episodes it has); a --fake run is flagged FAKE RUN; a run without
finished_at is an UNFINISHED RUN. Only a run that is none of these can pass.
"""

import argparse
import json
import re
import statistics
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent / "unit15"))

from aiplot.services import techniques  # noqa: E402
from check import GENRES, load  # noqa: E402

TARGET_CANDIDATES = 0.9
TARGET_RECOMMENDATIONS = 0.8
# Context size of the base profile (§13).
CTX = 12288

SENTENCE_END = re.compile(r"(?<=[.!?…])\s+")
# Closing marks after a sentence's last word: . ! ? … quotes (straight and curly) ) 」 』.
CLOSERS = ".!?…\"'\u201d\u2019)」』 "
TECHNIQUE_ID = re.compile(r"tech_[a-z]{3}_\d{3}")
COMBINING = re.compile(r"함께|합쳐|합치|결합|조합|어우러|곁들")


def heyo(reason: str) -> bool:
    """Every sentence ends in 요 (해요체), closing marks aside."""
    sentences = [s.rstrip(CLOSERS) for s in SENTENCE_END.split(reason.strip())]
    sentences = [s for s in sentences if s]
    return bool(sentences) and all(s.endswith("요") for s in sentences)


def score_stage(record: dict[str, Any], gold: dict[str, Any]) -> dict[str, Any]:
    accept = set(gold["accept"])
    picks_by_scene = {p["scene"]: p for p in record["picks"]}
    scenes = []
    for scene in (s for s in record["scenes"] if s["source"] == gold["stage"]):
        call = picks_by_scene.get(scene["scene"], {})
        found = call.get("candidates", [])
        combos = call.get("picks", [])
        scenes.append(
            {
                **scene,
                # 1-based rank of each accepted technique among the scene's candidates.
                "candidate_ranks": {t: found.index(t) + 1 for t in gold["accept"] if t in found},
                "candidates": len(found),
                "picks": combos,
                "pick_error": call.get("error"),
                "recommended": [c["rank"] for c in combos if accept.intersection(c["techniques"])],
            }
        )
    in_candidates = any(s["candidate_ranks"] for s in scenes)
    in_picks = any(s["recommended"] for s in scenes)
    # A single combination must hold an accepted technique (§20 step 2).
    single_misses = [s["scene"] for s in scenes if len(s["picks"]) == 1 and not s["recommended"]]
    return {
        "stage": gold["stage"],
        "accept": gold["accept"],
        "why": gold["why"],
        "scene_error": record["scene_call"].get("error"),
        "scenes": scenes,
        "in_candidates": in_candidates,
        "in_picks": in_picks,
        "single_misses": single_misses,
        "recommended": in_picks and not single_misses,
    }


def stats(values: list[float]) -> dict[str, float] | None:
    if not values:
        return None
    return {
        "n": len(values),
        "median": round(statistics.median(values), 1),
        "max": round(max(values), 1),
    }


def call_stats(calls: list[dict[str, Any]]) -> dict[str, Any]:
    """Failures, retries (more than one generation), times and tokens of made calls."""
    made = [c for c in calls if "error" not in c]
    failures: dict[str, int] = {}
    for call in calls:
        if "error" in call:
            failures[call["error"]] = failures.get(call["error"], 0) + 1
    used = [c["usage"] for c in made if c.get("usage")]
    return {
        "calls": len(calls),
        "failures": failures,
        "retried": sum(1 for c in made if c.get("generations", 1) > 1),
        "time_s": stats([c["total_s"] for c in made]),
        "prompt_tokens": stats([u["prompt_tokens"] for u in used]),
        "completion_tokens": stats([u["completion_tokens"] for u in used]),
        "max_total_tokens": max(
            (u["prompt_tokens"] + u["completion_tokens"] for u in used), default=None
        ),
        "ctx": CTX,
    }


def reason_stats(records: list[dict[str, Any]]) -> dict[str, Any]:
    reasons: list[tuple[str, dict[str, Any]]] = [
        (f"{r['id']} 장면 {call['scene']}", pick)
        for r in records
        for call in r["picks"]
        for pick in call.get("picks", [])
    ]
    return {
        "reasons": len(reasons),
        "heyo": sum(1 for _, p in reasons if heyo(p["reason"])),
        "not_heyo": [(where, p["reason"]) for where, p in reasons if not heyo(p["reason"])],
        "ids": [(where, p["reason"]) for where, p in reasons if TECHNIQUE_ID.search(p["reason"])],
        "single_combining": [
            (where, p["reason"])
            for where, p in reasons
            if len(p["techniques"]) == 1 and COMBINING.search(p["reason"])
        ],
    }


def score(run: dict[str, Any]) -> dict[str, Any]:
    by_id = {r["id"]: r for r in run["episodes"]}
    stages: list[dict[str, Any]] = []
    missing: list[str] = []
    for genre in GENRES:
        doc, _ = load(genre)
        for episode in doc["episodes"]:
            record = by_id.get(episode["id"])
            if record is None:
                missing.append(episode["id"])
                continue
            for gold in episode["gold"]:
                stages.append(
                    {
                        "genre": genre,
                        "id": episode["id"],
                        "name": episode["name"],
                        **score_stage(record, gold),
                    }
                )
    scored = len(stages)
    fake = bool(run.get("fake", False))
    finished = "finished_at" in run
    # A pass needs every case episode, the real model and a run that got to its end (§20: 20).
    full = scored > 0 and not missing and not fake and finished
    hits_c = sum(1 for s in stages if s["in_candidates"])
    hits_r = sum(1 for s in stages if s["recommended"])
    records = list(by_id.values())
    return {
        "fake": fake,
        "partial_run": {"missing": missing} if missing else None,
        "finished": finished,
        "scored": scored,
        "candidates": {
            "hits": hits_c,
            "rate": round(hits_c / scored, 3) if scored else None,
            "target": TARGET_CANDIDATES,
            "pass": full and hits_c / scored >= TARGET_CANDIDATES,
        },
        "recommendations": {
            "hits": hits_r,
            "rate": round(hits_r / scored, 3) if scored else None,
            "target": TARGET_RECOMMENDATIONS,
            "pass": full and hits_r / scored >= TARGET_RECOMMENDATIONS,
            "single_misses": sum(1 for s in stages if s["single_misses"]),
        },
        "reasons": reason_stats(records),
        "scene_calls": call_stats([r["scene_call"] for r in records]),
        "pick_calls": call_stats([call for r in records for call in r["picks"]]),
        "stages": stages,
    }


def mark(ok: bool) -> str:
    return "✓" if ok else "✗"


def spread(value: dict[str, float] | None, unit: str = "") -> str:
    if value is None:
        return "-"
    return f"중앙 {value['median']:g}{unit} · 최대 {value['max']:g}{unit}"


def share(part: dict[str, Any]) -> str:
    return "-" if part["rate"] is None else f"{part['rate']:.0%}"


def report(result: dict[str, Any], names: dict[str, str]) -> str:
    """The Markdown report: rates, then every scored stage with its scenes and picks."""

    def named(technique_id: str) -> str:
        return f"{names.get(technique_id, '?')} (`{technique_id}`)"

    c, r, why = result["candidates"], result["recommendations"], result["reasons"]
    lines = ["# Step 2 기법 선택 평가", ""]
    if result["fake"]:
        lines += ["> FAKE RUN: fixture 응답이라 측정이 아니에요.", ""]
    if result["partial_run"]:
        lines += [f"> PARTIAL RUN: 빠진 에피소드 {', '.join(result['partial_run']['missing'])}", ""]
    if not result["finished"]:
        lines += ["> UNFINISHED RUN: 실행이 끝나지 않았어요 (finished_at 없음).", ""]
    lines += [
        f"- 후보 안에 정답: {c['hits']}/{result['scored']} ({share(c)}, "
        f"목표 {c['target']:.0%}) {mark(c['pass'])}",
        f"- 추천 안에 정답: {r['hits']}/{result['scored']} ({share(r)}, "
        f"목표 {r['target']:.0%}) {mark(r['pass'])} "
        f"(추천이 하나뿐인데 정답이 없는 단계 {r['single_misses']})",
        f"- 이유 해요체: {why['heyo']}/{why['reasons']}, id 노출 {len(why['ids'])}, "
        f"단일 기법인데 결합 표현 {len(why['single_combining'])}",
        "",
    ]
    for label, key in (("scene", "scene_calls"), ("pick", "pick_calls")):
        s = result[key]
        lines.append(
            f"- {label} 호출 {s['calls']}: 실패 {sum(s['failures'].values())} "
            f"{s['failures'] or ''}, 재생성 {s['retried']}, "
            f"시간 {spread(s['time_s'], 's')}, 프롬프트 토큰 {spread(s['prompt_tokens'])}, "
            f"출력 토큰 {spread(s['completion_tokens'])}, "
            f"최대 합계 {s['max_total_tokens'] or '-'}/{s['ctx']}"
        )
    lines.append("")
    for title, entries in (
        ("해요체가 아닌 이유", why["not_heyo"]),
        ("id가 들어간 이유", why["ids"]),
        ("단일 기법인데 결합 표현", why["single_combining"]),
    ):
        if entries:
            lines += [f"## {title}", ""] + [f"- {where}: {text}" for where, text in entries] + [""]
    for stage in result["stages"]:
        lines += [
            f"## {stage['name']} · {stage['stage']} ({stage['genre']} `{stage['id']}`) "
            f"후보 {mark(stage['in_candidates'])} 추천 {mark(stage['recommended'])}",
            "",
            f"- 정답: {', '.join(named(t) for t in stage['accept'])}",
            f"- 근거: {stage['why']}",
        ]
        if stage["scene_error"]:
            lines.append(f"- scene 실패: {stage['scene_error']}")
        if not stage["scenes"] and not stage["scene_error"]:
            lines.append("- 이 단계에서 나온 장면 없음")
        for scene in stage["scenes"]:
            ranks = ", ".join(f"{named(t)} {n}위" for t, n in scene["candidate_ranks"].items())
            lines += [
                "",
                f"### 장면 {scene['scene']}: {scene['summary']}",
                f"- 효과 {', '.join(scene['effects'])} · 상황 {', '.join(scene['situations'])}",
                f"- 후보 {scene['candidates']}개, 정답 순위: {ranks or '없음'}",
            ]
            if scene["pick_error"]:
                lines.append(f"- pick 실패: {scene['pick_error']}")
            for pick in scene["picks"]:
                hit = " ← 정답" if pick["rank"] in scene["recommended"] else ""
                lines.append(
                    f"- {pick['rank']}. {' + '.join(named(t) for t in pick['techniques'])}{hit}: "
                    f"{pick['reason']}"
                )
        lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("run", type=Path)
    parser.add_argument("--json", type=Path, help="write the scores here")
    parser.add_argument("--md", type=Path, help="write the Markdown report here")
    args = parser.parse_args()

    result = score(json.loads(args.run.read_text(encoding="utf-8")))
    c, r = result["candidates"], result["recommendations"]
    print(f"candidates {c['hits']}/{result['scored']} pass={c['pass']}")
    print(f"recommendations {r['hits']}/{result['scored']} pass={r['pass']}")
    print(f"reasons heyo {result['reasons']['heyo']}/{result['reasons']['reasons']}")
    if result["fake"]:
        print("FAKE RUN: fixture output, not a measurement", file=sys.stderr)
    if result["partial_run"]:
        print(f"PARTIAL RUN: missing {result['partial_run']['missing']}", file=sys.stderr)
    if not result["finished"]:
        print("UNFINISHED RUN: no finished_at", file=sys.stderr)
    if args.json:
        args.json.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    if args.md:
        names = {card.id: card.name for card in techniques.load()}
        args.md.write_text(report(result, names), encoding="utf-8")


if __name__ == "__main__":
    main()
