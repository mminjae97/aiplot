"""Step 2: scores a run_direction.py result against the cases' gold (§20 step 2).

    uv run python eval/step2/score_direction.py eval/results/step2/run11.json \
        --json eval/results/step2/score-run11.json --md eval/results/step2/report-run11.md

Per scored stage (README Scoring): its scenes are those whose source is that stage; none (the
scene call failed or gave the stage no scene) = a miss.
- Labelled (the pass criterion): the stage's devices from a blind labeller
  (devices/stages-claude.json, standing in for the user's correction, §9) given to each of its
  scenes with the scene's own tags, ranked by `direction.rank`: right if an accepted technique
  is among the 5 of any of them.
- AI draft: the same with the devices the scene role answered yes (the run's recommendations),
  and the first 20 of that ranking. Recorded, no criterion.
- Agreement: the AI's yes devices against the labels over the scored stages' scenes.

Also reported: devices answered yes per scene; scene call failures, retries, times and token
counts against the context size. A run missing a case episode is a PARTIAL RUN (scored over the
episodes it has); a --fake run is flagged FAKE RUN; a run without finished_at is an UNFINISHED
RUN. Only a run that is none of these can pass.
"""

import argparse
import json
import statistics
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent / "unit15"))

from aiplot.services import direction, techniques  # noqa: E402
from check import GENRES, load  # noqa: E402

TARGET = 0.8
LABELS = json.loads((HERE / "devices" / "stages-claude.json").read_text(encoding="utf-8"))
CATALOG = techniques.load()
# Context size of the base profile (§13).
CTX = 12288


def score_stage(record: dict[str, Any], gold: dict[str, Any]) -> dict[str, Any]:
    accept = set(gold["accept"])
    labels = LABELS[record["id"]][gold["stage"]]
    by_scene = {r["scene"]: r for r in record["recommendations"]}
    scenes = []
    for scene in (s for s in record["scenes"] if s["source"] == gold["stage"]):
        found = by_scene.get(scene["scene"], {"recommended": [], "ranked": []})
        ranked = found["ranked"]
        labelled = [
            asdict(r)
            for r in direction.rank(CATALOG, labels, scene["effects"], scene["situations"])
        ]
        scenes.append(
            {
                **scene,
                "labels": labels,
                "labelled": labelled,
                "labelled_hits": [r["rank"] for r in labelled if r["technique_id"] in accept],
                "recommended": found["recommended"],
                # 1-based rank of each accepted technique in the AI draft's first 20.
                "gold_ranks": {t: ranked.index(t) + 1 for t in gold["accept"] if t in ranked},
                "hits": [r["rank"] for r in found["recommended"] if r["technique_id"] in accept],
            }
        )
    return {
        "stage": gold["stage"],
        "accept": gold["accept"],
        "why": gold["why"],
        "scene_error": record["scene_call"].get("error"),
        "scenes": scenes,
        "labelled": any(s["labelled_hits"] for s in scenes),
        "recommended": any(s["hits"] for s in scenes),
        "top20": any(s["gold_ranks"] for s in scenes),
    }


def stats(values: list[float]) -> dict[str, float] | None:
    if not values:
        return None
    return {
        "n": len(values),
        "mean": round(statistics.mean(values), 1),
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


def agreement(stages: list[dict[str, Any]]) -> dict[str, Any]:
    """The AI's yes devices against the labels, summed over the scored stages' scenes."""
    both = ai = labelled = 0
    for stage in stages:
        for scene in stage["scenes"]:
            yes, labels = set(scene["devices"]), set(scene["labels"])
            both += len(yes & labels)
            ai += len(yes)
            labelled += len(labels)
    return {
        "shared": both,
        "ai_yes": ai,
        "labels": labelled,
        "precision": round(both / ai, 3) if ai else None,
        "recall": round(both / labelled, 3) if labelled else None,
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
    hits = sum(1 for s in stages if s["labelled"])
    records = list(by_id.values())
    yes = [float(len(s["devices"])) for r in records for s in r["scenes"]]
    return {
        "fake": fake,
        "partial_run": {"missing": missing} if missing else None,
        "finished": finished,
        "scored": scored,
        "labelled": {
            "hits": hits,
            "rate": round(hits / scored, 3) if scored else None,
            "target": TARGET,
            "pass": full and hits / scored >= TARGET,
        },
        "ai_draft": {
            "hits": sum(1 for s in stages if s["recommended"]),
            "top20": sum(1 for s in stages if s["top20"]),
        },
        "agreement": agreement(stages),
        "devices_per_scene": stats(yes),
        "scene_calls": call_stats([r["scene_call"] for r in records]),
        "stages": stages,
    }


def mark(ok: bool) -> str:
    return "✓" if ok else "✗"


def spread(value: dict[str, float] | None, unit: str = "") -> str:
    if value is None:
        return "-"
    return f"중앙 {value['median']:g}{unit} · 최대 {value['max']:g}{unit}"


def card_lines(cards: list[dict[str, Any]], hits: list[int], named: Any) -> list[str]:
    lines = []
    for card in cards:
        hit = " ← 정답" if card["rank"] in hits else ""
        shared = ", ".join(card["devices"] + card["effects"] + card["situations"])
        lines.append(f"  - {card['rank']}. {named(card['technique_id'])}{hit}: {shared}")
    return lines


def report(result: dict[str, Any], names: dict[str, str]) -> str:
    """The Markdown report: rates, then every scored stage with its scenes and cards."""

    def named(technique_id: str) -> str:
        return f"{names.get(technique_id, '?')} (`{technique_id}`)"

    r, ai, ag, s = (
        result["labelled"],
        result["ai_draft"],
        result["agreement"],
        result["scene_calls"],
    )
    rate = "-" if r["rate"] is None else f"{r['rate']:.0%}"
    per_scene = result["devices_per_scene"]
    yes = "-"
    if per_scene is not None:
        yes = f"평균 {per_scene['mean']:g} · 중앙 {per_scene['median']:g}"
        yes += f" · 최대 {per_scene['max']:g}"
    share = "-"
    if ag["precision"] is not None and ag["recall"] is not None:
        share = (
            f"AI의 예 중 라벨에도 있는 것 {ag['shared']}/{ag['ai_yes']} ({ag['precision']:.0%}), "
        )
        share += f"라벨 중 AI도 예라고 한 것 {ag['shared']}/{ag['labels']} ({ag['recall']:.0%})"
    lines = ["# Step 2 기법 추천 평가", ""]
    if result["fake"]:
        lines += ["> FAKE RUN: fixture 응답이라 측정이 아니에요.", ""]
    if result["partial_run"]:
        lines += [f"> PARTIAL RUN: 빠진 에피소드 {', '.join(result['partial_run']['missing'])}", ""]
    if not result["finished"]:
        lines += ["> UNFINISHED RUN: 실행이 끝나지 않았어요 (finished_at 없음).", ""]
    lines += [
        f"- 라벨 장치로 추천한 5장 안에 정답: {r['hits']}/{result['scored']} ({rate}, "
        f"목표 {r['target']:.0%}) {mark(r['pass'])}",
        f"- AI 초안 장치로 추천한 5장 안에 정답: {ai['hits']}/{result['scored']}, "
        f"20위 안: {ai['top20']}/{result['scored']}",
        f"- AI 장치와 라벨의 일치: {share}",
        f"- 장면당 AI가 예라고 답한 장치: {yes}",
        f"- scene 호출 {s['calls']}: 실패 {sum(s['failures'].values())} {s['failures'] or ''}, "
        f"재생성 {s['retried']}, 시간 {spread(s['time_s'], 's')}, "
        f"프롬프트 토큰 {spread(s['prompt_tokens'])}, 출력 토큰 {spread(s['completion_tokens'])}, "
        f"최대 합계 {s['max_total_tokens'] or '-'}/{s['ctx']}",
        "",
    ]
    for stage in result["stages"]:
        lines += [
            f"## {stage['name']} · {stage['stage']} ({stage['genre']} `{stage['id']}`) "
            f"라벨 {mark(stage['labelled'])} AI {mark(stage['recommended'])}",
            "",
            f"- 정답: {', '.join(named(t) for t in stage['accept'])}",
            f"- 근거: {stage['why']}",
        ]
        if stage["scene_error"]:
            lines.append(f"- scene 실패: {stage['scene_error']}")
        if not stage["scenes"] and not stage["scene_error"]:
            lines.append("- 이 단계에서 나온 장면 없음")
        for scene in stage["scenes"]:
            ranks = ", ".join(f"{named(t)} {n}위" for t, n in scene["gold_ranks"].items())
            lines += [
                "",
                f"### 장면 {scene['scene']}: {scene['summary']}",
                f"- 효과 {', '.join(scene['effects'])} · 상황 {', '.join(scene['situations'])}",
                f"- 라벨 장치 {', '.join(scene['labels']) or '없음'}",
                *card_lines(scene["labelled"], scene["labelled_hits"], named),
                f"- AI 장치 {', '.join(scene['devices']) or '없음'}",
                f"  (AI 초안 20위 안 정답: {ranks or '없음'})",
                *card_lines(scene["recommended"], scene["hits"], named),
            ]
        lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("run", type=Path)
    parser.add_argument("--json", type=Path, help="write the scores here")
    parser.add_argument("--md", type=Path, help="write the Markdown report here")
    args = parser.parse_args()

    result = score(json.loads(args.run.read_text(encoding="utf-8")))
    r, ai = result["labelled"], result["ai_draft"]
    print(f"labelled {r['hits']}/{result['scored']} pass={r['pass']}")
    print(f"ai draft {ai['hits']}/{result['scored']} top20 {ai['top20']}/{result['scored']}")
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
