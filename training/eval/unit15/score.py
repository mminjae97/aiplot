"""Step 1 unit 15: scores a run.py result against the cases' gold (§20 pass criteria).

    uv run python eval/unit15/score.py eval/results/unit15/run1.json \
        --judged eval/results/unit15/judged-run1.json --html eval/results/unit15/report-run1.html

Gold kinds: exact (same value, or one of `any_of`), ids (same set of card ids), empty (not in
the notes: filled without being marked AI 추정 is an unsupported fill), optional (not scored
for match; filled with no evidence sentence and not marked AI 추정, it needs a judgement like
free text, unless `given` (the input fixed it); unjudged ones are pending),
and facts / items (free text: judged by Claude in --judged, {"case id": {"path": {"match":
bool, "unsupported": bool, "note": str}}}, then checked by the user in the report). Fields
still unjudged show as pending and are left out of the rates, except an empty facts / items
field: a miss without a judgement. An ids field holding ids that miss the gold needs a
judgement for unsupported (pending until then). A card the run failed to make counts every
scored field as a miss. A run missing any case or name turn is flagged PARTIAL RUN.

Unsupported fill = unsupported / filled fields, over fields that can be unsupported (not exact
or given ones). Name false rate = wrong pairs in the turns that must flag none / those turns.
A pair naming part of the card's name (무현 for 연무현), or the name with more, is fair.
"""

import argparse
import html
import json
import statistics
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).parent
GENRES = ["fantasy", "hunter", "romance", "wuxia", "mystery", "scifi"]
TYPE_KO = {
    "world": "세계관",
    "character": "캐릭터",
    "region": "지역",
    "main_story": "메인 스토리",
    "part": "부",
    "episode": "에피소드",
}


def value_at(card: dict[str, Any], path: str) -> Any:
    if path == "name":
        return card.get("name")
    node: Any = card.get("data")
    for key in path.split("."):
        if not isinstance(node, dict):
            return None
        node = node.get(key)
    return node


def empty(value: Any) -> bool:
    return (
        value is None
        or value == []
        or value == {}
        or (isinstance(value, str) and not value.strip())
    )


def ids_of(path: str, value: Any) -> set[str]:
    if not isinstance(value, list):
        return set()
    if path == "relations":
        return {str(item.get("target_id")) for item in value if isinstance(item, dict)}
    return {item for item in value if isinstance(item, str)}


def guessed(card: dict[str, Any], path: str) -> bool:
    return any(path == g or path.startswith(g + ".") for g in card.get("ai_guess") or [])


def evidenced(card: dict[str, Any], path: str) -> bool:
    """Some evidence sentence backs the field (its own path, a parent or a child)."""
    evidence = card.get("evidence") or {}
    return any(
        (path == key or path.startswith(key + ".") or key.startswith(path + ".")) and indexes
        for key, indexes in evidence.items()
    )


SCORED = ("exact", "ids", "facts", "items")


def score_field(
    gold: dict[str, Any], card: dict[str, Any], judged: dict[str, Any] | None
) -> dict[str, Any]:
    path = gold["path"]
    value = value_at(card, path)
    kind = gold["kind"]
    out: dict[str, Any] = {"path": path, "kind": kind, "value": value, "gold": gold}
    if kind == "optional":
        out["verdict"] = "skip"
        unbacked = not empty(value) and not guessed(card, path) and not evidenced(card, path)
        if gold.get("given") or not unbacked:
            out["unsupported"] = False
        elif judged is not None:
            out["unsupported"] = bool(judged.get("unsupported"))
            out["note"] = judged.get("note", "")
        else:
            # No evidence is not proof of invention (the model often leaves evidence out).
            out["unsupported_pending"] = True
    elif kind == "exact":
        accepted = gold["any_of"] if "any_of" in gold else [gold["value"]]
        out["verdict"] = "match" if value in accepted else "miss"
    elif kind == "ids":
        out["verdict"] = "match" if ids_of(path, value) == set(gold["value"]) else "miss"
        if out["verdict"] == "miss" and judged is None and not empty(value):
            # Wrong ids may still be ones the notes give: unsupported needs a judgement.
            out["unsupported_pending"] = True
    elif kind == "empty":
        out["verdict"] = "skip"
        out["unsupported"] = not empty(value) and not guessed(card, path)
    elif judged is not None:
        out["verdict"] = "match" if judged.get("match") else "miss"
        out["unsupported"] = bool(judged.get("unsupported"))
        out["note"] = judged.get("note", "")
    elif empty(value):
        # Nothing there to judge: the gold's facts are missing.
        out["verdict"] = "miss"
    else:
        out["verdict"] = "pending"
    # An ids field may be judged too: its relation words (a match can still miss) and ids the
    # notes never give (unsupported).
    if kind == "ids" and judged is not None:
        if judged.get("match") is False:
            out["verdict"] = "miss"
        out["unsupported"] = bool(judged.get("unsupported"))
        out["note"] = judged.get("note", "")
    return out


def given_name(pair: dict[str, Any]) -> bool:
    """The user wrote part of the card's name (or the name plus more): fair to ask."""
    mentioned = str(pair.get("mentioned") or "").replace(" ", "")
    name = str(pair.get("similar_to") or "").replace(" ", "")
    return bool(mentioned and name) and (mentioned in name or name in mentioned)


def same(pair: dict[str, Any], expect: dict[str, Any]) -> bool:
    """The pair names the expected card and the mentioned name, either way round (the
    question shown is the same)."""
    names = {pair.get("mentioned"), pair.get("similar_to")}
    return pair.get("card_id") == expect["card_id"] and expect["mentioned"] in names


def rate(hit: int, total: int) -> float | None:
    return round(hit / total, 3) if total else None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("run", type=Path)
    parser.add_argument("--judged", type=Path)
    parser.add_argument("--html", type=Path)
    args = parser.parse_args()

    run = json.loads(args.run.read_text(encoding="utf-8"))
    judged_all = json.loads(args.judged.read_text(encoding="utf-8")) if args.judged else {}
    genres = {
        g: json.loads((HERE / "cases" / f"{g}.json").read_text(encoding="utf-8")) for g in GENRES
    }
    cases = {c["id"]: c for g in genres.values() for c in g["cases"]}
    names = {n["id"]: n for g in genres.values() for n in g["names"]}

    rows: list[dict[str, Any]] = []
    fields = matched = pending = unsupported = filled = invalid = retried = 0
    by_type: dict[str, list[int]] = {}
    for result in run["cards"]:
        case = cases[result["id"]]
        if result.get("attempts", 1) > 1:
            retried += 1
        if "card" not in result:
            invalid += 1
            # Every field the card should have had is a miss.
            for gold in case["gold"]:
                if gold["kind"] in SCORED:
                    fields += 1
                    by_type.setdefault(case["type"], [0, 0])[1] += 1
            rows.append({"case": case, "result": result, "fields": []})
            continue
        card = result["card"]
        scored = [
            score_field(g, card, judged_all.get(case["id"], {}).get(g["path"]))
            for g in case["gold"]
        ]
        for s in scored:
            if s["verdict"] in ("match", "miss"):
                fields += 1
                matched += s["verdict"] == "match"
                tally = by_type.setdefault(case["type"], [0, 0])
                tally[0] += s["verdict"] == "match"
                tally[1] += 1
            pending += s["verdict"] == "pending" or bool(s.get("unsupported_pending"))
            if (
                s["kind"] != "exact"
                and s["verdict"] != "pending"
                and not s.get("unsupported_pending")
                and not s["gold"].get("given")
                and not empty(s["value"])
            ):
                filled += 1
                unsupported += bool(s.get("unsupported"))
        rows.append({"case": case, "result": result, "fields": scored})

    found = expected = false_pairs = negatives = 0
    name_rows = []
    for result in run["names"]:
        case = names[result["id"]]
        pairs = result.get("similar_names") or []
        hits = [e for e in case["expect"] if any(same(p, e) for p in pairs)]
        # `allow`: pairs that are fair to ask about (a given name and the full name).
        fine = case["expect"] + case.get("allow", [])
        wrong = [p for p in pairs if not given_name(p) and not any(same(p, e) for e in fine)]
        expected += len(case["expect"])
        if not case["expect"]:
            # The false rate is over the turns that must flag none: their wrong pairs.
            negatives += 1
            false_pairs += len(wrong)
        found += len(hits)
        name_rows.append({"case": case, "result": result, "hits": hits, "wrong": wrong})

    # A run made with run.py --cases or --skip-names scores like a full one: say so.
    missing_cases = sorted(set(cases) - {r["id"] for r in run["cards"]})
    missing_names = sorted(set(names) - {r["id"] for r in run["names"]})
    partial = bool(missing_cases or missing_names)
    print(
        f"scored {len(run['cards'])} / {len(cases)} cards, "
        f"{len(run['names'])} / {len(names)} name turns",
        file=sys.stderr,
    )
    if partial:
        print(
            f"PARTIAL RUN: missing cards {missing_cases or 'none'}, "
            f"name turns {missing_names or 'none'}; rates are not comparable to a full run",
            file=sys.stderr,
        )

    firsts = [r["first_char_s"] for r in run["names"] if r.get("first_char_s") is not None]
    card_usage = [r["usage"] for r in run["cards"] if r.get("usage")]
    summary = {
        "partial_run": partial,
        "missing_cases": missing_cases,
        "missing_name_turns": missing_names,
        "field_match": rate(matched, fields),
        "fields_scored": fields,
        "fields_pending": pending,
        "field_match_by_type": {t: rate(a, b) for t, (a, b) in by_type.items()},
        "unsupported_fill": rate(unsupported, filled),
        "unsupported_fields": unsupported,
        "filled_fields": filled,
        "json_invalid": invalid,
        "json_retried": retried,
        "cards": len(run["cards"]),
        "cards_expected": len(cases),
        "name_turns": len(run["names"]),
        "name_turns_expected": len(names),
        "names_found": rate(found, expected),
        "names_expected": expected,
        # Wrong pairs per turn that must flag none.
        "names_false": rate(false_pairs, negatives),
        "names_false_pairs": false_pairs,
        "chat_first_char_s": {
            "median": statistics.median(firsts) if firsts else None,
            "max": max(firsts) if firsts else None,
        },
        "card_tokens": {
            "prompt_median": statistics.median(u["prompt_tokens"] for u in card_usage)
            if card_usage
            else None,
            "prompt_max": max((u["prompt_tokens"] for u in card_usage), default=None),
            "completion_median": statistics.median(u["completion_tokens"] for u in card_usage)
            if card_usage
            else None,
            "completion_max": max((u["completion_tokens"] for u in card_usage), default=None),
        },
        "card_seconds": {
            "median": statistics.median(r["total_s"] for r in run["cards"])
            if run["cards"]
            else None,
            "max": max((r["total_s"] for r in run["cards"]), default=None),
        },
    }
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    if args.html:
        args.html.write_text(report(summary, rows, name_rows), encoding="utf-8")
        print(f"wrote {args.html}")


def show(value: Any) -> str:
    if value is None:
        return '<span class="none">(비어 있음)</span>'
    if isinstance(value, str):
        return html.escape(value)
    return "<pre>" + html.escape(json.dumps(value, ensure_ascii=False, indent=1)) + "</pre>"


VERDICT = {
    "match": ("맞음", "ok"),
    "miss": ("틀림", "bad"),
    "pending": ("판정 전", "wait"),
    "skip": ("채점 안 함", "skip"),
}


def pct(value: float | None) -> str:
    return "-" if value is None else f"{value * 100:.1f}%"


def tr(cells: list[str], cls: str = "") -> str:
    return f"<tr class='{cls}'>" + "".join(f"<td>{c}</td>" for c in cells) + "</tr>"


def summary_table(s: dict[str, Any]) -> str:
    first = s["chat_first_char_s"]
    tokens = s["card_tokens"]
    seconds = s["card_seconds"]
    rows = [
        [
            "카드 필드 일치율",
            pct(s["field_match"]),
            f"목표 85% 이상 · 채점 {s['fields_scored']}개, 판정 전 {s['fields_pending']}개",
        ],
        [
            "근거 없는 채움",
            pct(s["unsupported_fill"]),
            f"목표 5% 이하 · 채운 필드 {s['filled_fields']}개 중 {s['unsupported_fields']}개",
        ],
        [
            "JSON 실패(재시도 1번 포함)",
            f"{s['json_invalid']} / {s['cards']}",
            f"목표 0 · 재시도가 쓰인 카드 {s['json_retried']}장",
        ],
        [
            "비슷한 이름 감지",
            pct(s["names_found"]),
            f"목표 90% 이상 · 기대 {s['names_expected']}쌍",
        ],
        [
            "잘못 감지",
            pct(s["names_false"]),
            f"목표 10% 이하 · 잘못 낸 쌍 {s['names_false_pairs']}개",
        ],
        ["대화 첫 글자", f"중앙 {first['median']}초 · 최대 {first['max']}초", "목표 2초 이내"],
        [
            "카드 생성",
            f"중앙 {seconds['median']}초 · 최대 {seconds['max']}초",
            f"입력 토큰 중앙 {tokens['prompt_median']} · 최대 {tokens['prompt_max']}, "
            f"출력 중앙 {tokens['completion_median']} · 최대 {tokens['completion_max']}",
        ],
    ]
    by_type = ", ".join(f"{TYPE_KO[t]} {pct(v)}" for t, v in s["field_match_by_type"].items())
    rows.append(["종류별 일치율", by_type, ""])
    warning = ""
    if s["partial_run"]:
        warning = (
            "<p class='warn'>일부만 실행한 결과예요 (카드 "
            f"{s['cards']} / {s['cards_expected']}장, 이름 대화 "
            f"{s['name_turns']} / {s['name_turns_expected']}개). 전체 실행과 비교할 수 없어요.</p>"
        )
    return warning + "<table class='sum'>" + "".join(tr(r) for r in rows) + "</table>"


def wanted(gold: dict[str, Any]) -> str:
    if gold["kind"] == "empty":
        return "원문에 없음 (비어 있거나 AI 추정)"
    facts = " / ".join(html.escape(x) for x in gold.get("facts", []))
    if "value" in gold:
        value = html.escape(json.dumps(gold["value"], ensure_ascii=False))
        return value + (f" — {facts}" if facts else "")
    return facts


def card_section(row: dict[str, Any]) -> str:
    case, result = row["case"], row["result"]
    notes = "".join(f"<li>{html.escape(line)}</li>" for line in case["notes"].split("\n"))
    trs = []
    for f in row["fields"]:
        label, cls = VERDICT[f["verdict"]]
        if f.get("unsupported"):
            label, cls = label + " · 근거 없음", "bad"
        note = f"<div class='note'>{html.escape(f.get('note', ''))}</div>"
        trs.append(
            tr(
                [f"<code>{f['path']}</code>", show(f["value"]), wanted(f["gold"]), label + note],
                cls,
            )
        )
    if "card" not in result:
        failed = html.escape(f"{result.get('error', '')} {result.get('message', '')}")
        trs.append(f"<tr class='bad'><td colspan=4>생성 실패: {failed}</td></tr>")
    guess = ", ".join((result.get("card") or {}).get("ai_guess") or []) or "없음"
    title = (
        f"{case['id']} · {TYPE_KO[case['type']]} · "
        f"{result.get('total_s')}초 · 시도 {result.get('attempts')}번"
    )
    return (
        f"<section><h3>{title}</h3>"
        f"<details><summary>원문</summary><ol class='notes'>{notes}</ol></details>"
        f"<p class='small'>AI 추정 표시: {html.escape(guess)}</p>"
        "<table><tr><th>필드</th><th>생성된 값</th><th>정답</th><th>판정</th></tr>"
        + "".join(trs)
        + "</table></section>"
    )


def name_row(n: dict[str, Any]) -> str:
    case, result = n["case"], n["result"]
    want = ", ".join(f"{e['mentioned']}→{e['card_id']}" for e in case["expect"]) or "없음"
    pairs = result.get("similar_names") or []
    got = ", ".join(f"{p.get('mentioned')}→{p.get('card_id')}" for p in pairs) or "없음"
    ok = len(n["hits"]) == len(case["expect"]) and not n["wrong"]
    cells = [case["id"], html.escape(case["text"]), html.escape(want), html.escape(got)]
    return tr([*cells, f"{result.get('first_char_s')}초"], "ok" if ok else "bad")


def report(
    summary: dict[str, Any], rows: list[dict[str, Any]], name_rows: list[dict[str, Any]]
) -> str:
    style = (HERE / "report.css").read_text(encoding="utf-8")
    names = "".join(name_row(n) for n in name_rows)
    return (
        f"<!doctype html><meta charset=utf-8><title>유닛 15 평가 결과</title><style>{style}</style>"
        f"<h1>유닛 15 평가 결과</h1>{summary_table(summary)}<h2>카드</h2>"
        + "".join(card_section(r) for r in rows)
        + "<h2>비슷한 이름 감지</h2><table><tr><th>id</th><th>대화</th><th>정답</th>"
        f"<th>감지</th><th>첫 글자</th></tr>{names}</table>"
    )


if __name__ == "__main__":
    main()
