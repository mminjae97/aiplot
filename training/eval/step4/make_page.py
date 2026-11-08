"""Step 4: the blind scoring page for a run of run_bundles.py (§20 step 4).

    uv run python eval/step4/make_page.py eval/results/step4/run1.json \
        --dir eval/results/step4/run1

Writes into --dir:
- `bundles.html`: one self-contained page (no network) with every bundle in a shuffled order
  under a number (묶음 01…), the rubric, and a scoring form per bundle. Scores stay in the
  browser (localStorage, per page) until exported as `scores-{scorer}-{page}.json`.
- `bundles.md`: the same bundles as text, for Claude to score apart (writing the same JSON).
- `key.json`: bundle number -> episode id and genre, for score_bundles.py. Not shown to scorers.

Blind: no episode id, genre, run, prompt version, time or token count reaches the page; a bundle
shows the episode as written (theme, synopsis, stages with tension, foreshadowing) and the plan
(chapters, scenes in narration order with their core, reveals and cards, and beats), with the
text of the cards it names. A bundle whose plan failed is listed as not to be scored.
"""

import argparse
import hashlib
import html
import json
import random
from pathlib import Path
from typing import Any

HERE = Path(__file__).parent
RUBRIC = HERE / "rubric.json"
SEED = 4

MODE_FOCUS = ("pov", "mode", "focus", "density")


def e(value: Any) -> str:
    return html.escape(str(value))


def card_names(record: dict[str, Any], ids: list[str]) -> str:
    cards = record.get("techniques", {})
    return ", ".join(cards.get(i, {}).get("name", i) for i in ids) or "없음"


# Markdown --------------------------------------------------------------------------------------


def bundle_md(number: str, record: dict[str, Any]) -> list[str]:
    episode = record["episode"]
    lines = [f"## 묶음 {number}: {episode['name']}", ""]
    lines += [f"- 주제: {episode['theme']}", f"- 시놉시스: {episode['synopsis']}"]
    for stage in episode["structure"]["stages"]:
        lines.append(f"- 단계 {stage['name']} (긴장 {stage['tension']}): {stage['summary']}")
    lines.append(f"- 이 화에서 심는 복선: {', '.join(episode['plants']) or '없음'}")
    lines.append(f"- 이 화에서 회수하는 복선: {', '.join(episode['payoffs']) or '없음'}")
    lines.append("")
    plan = record.get("plan")
    if plan is None:
        return [*lines, "**연출 실패: 채점하지 않음**", ""]
    for chapter in plan["chapters"]:
        lines += [f"### {chapter['chapter']}화 ({chapter['target_chars']}자)", ""]
        for scene in chapter["scenes"]:
            lines.append(
                f"#### 장면 {scene['scene']} (단계 {scene['source']}, {scene['target_chars']}자)"
            )
            lines.append(f"- 요약: {scene['summary']}")
            lines.append(f"- 핵심: {scene['core']}")
            lines.append(f"- 공개: {' / '.join(scene['reveal']) or '없음'}")
            lines.append(f"- 고른 카드: {card_names(record, scene['chosen'])}")
            if not scene["beats"]:
                lines.append("- 비트: 연출되지 않음")
            for beat in scene["beats"]:
                how = " · ".join(str(beat[key]) for key in MODE_FOCUS)
                lines.append(
                    f"  {beat['order']}. [{how} · 긴장 {beat['tension']} · "
                    f"{beat['target_chars']}자 · {card_names(record, beat['techniques'])}] "
                    f"{beat['summary']}"
                )
            lines.append("")
    lines.append("#### 카드")
    for card in record.get("techniques", {}).values():
        lines.append(f"- {card['name']}: {card['description']} / 적용: {card['mechanism']}")
    return [*lines, ""]


# HTML ------------------------------------------------------------------------------------------

STYLE = """
:root { --paper: #ede3cf; --ink: #3b2f22; --soft: #6b5a45; --edge: #d8c9ab; --brass: #9a7426;
  --danger: #9c2f24; }
* { box-sizing: border-box; }
body { margin: 0; background: #e4d7bb; color: var(--ink);
  font: 15px/1.6 "Source Han Sans KR", "Noto Sans KR", "Malgun Gothic", sans-serif; }
header { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 12px;
  align-items: center; padding: 10px 20px; background: var(--paper);
  border-bottom: 1px solid var(--edge); }
header h1 { margin: 0 12px 0 0; font-size: 18px; }
nav { display: flex; flex-wrap: wrap; gap: 4px; }
nav a { padding: 1px 7px; border: 1px solid var(--edge); border-radius: 3px; color: var(--ink);
  text-decoration: none; font-size: 13px; }
nav a[data-done] { background: var(--brass); color: #fff8ea; border-color: var(--brass); }
nav a[data-failed] { opacity: 0.4; text-decoration: line-through; }
button, input { font: inherit; }
button { border: 1px solid var(--soft); border-radius: 3px; background: var(--paper);
  padding: 3px 12px; }
main { max-width: 1080px; margin: 0 auto; padding: 16px 20px 80px; }
section.bundle, details.rubric { margin: 18px 0; padding: 18px 22px; background: var(--paper);
  border: 1px solid var(--edge); border-radius: 4px; }
section.bundle { scroll-margin-top: 110px; }
h2 { margin: 0 0 8px; font-size: 20px; }
h3 { margin: 18px 0 6px; font-size: 16px; color: var(--brass); }
h4 { margin: 12px 0 4px; font-size: 15px; }
.muted { color: var(--soft); font-size: 13px; }
.stages td, .beats td, .beats th { padding: 3px 8px; vertical-align: top;
  border-bottom: 1px solid var(--edge); }
table { border-collapse: collapse; width: 100%; }
.beats th { text-align: left; font-size: 13px; color: var(--soft); white-space: nowrap; }
.beats td.n { white-space: nowrap; font-size: 13px; }
.scene { margin: 8px 0 14px; padding-left: 12px; border-left: 3px solid var(--edge); }
.failed { color: var(--danger); font-weight: 700; }
.score { margin-top: 18px; padding-top: 10px; border-top: 2px solid var(--brass); }
.item { display: grid; grid-template-columns: 120px 1fr; gap: 4px 12px; margin: 8px 0; }
.item .q { grid-column: 2; color: var(--soft); font-size: 13px; }
.item label { margin-right: 12px; white-space: nowrap; }
textarea { width: 100%; min-height: 54px; font: inherit; }
dl.anchors dt { font-weight: 700; }
dl.anchors dd { margin: 0 0 6px 16px; }
"""

SCRIPT = """
const PAGE = document.body.dataset.page;
const STORE = 'aiplot-step4-' + PAGE;
const ITEMS = JSON.parse(document.body.dataset.items);
function load() {
  try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (e) { return {}; }
}
function save(state) {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* kept on screen */ }
}
let state = load();
function refresh() {
  let done = 0, total = 0;
  document.querySelectorAll('form.score').forEach((form) => {
    total += 1;
    const n = form.dataset.bundle;
    const s = (state.scores || {})[n] || {};
    const complete = ITEMS.every((k) => s[k]);
    if (complete) done += 1;
    const link = document.querySelector('nav a[href="#b' + n + '"]');
    if (link) link.toggleAttribute('data-done', complete);
  });
  document.getElementById('progress').textContent = done + ' / ' + total + ' 채점';
}
document.querySelectorAll('form.score').forEach((form) => {
  const n = form.dataset.bundle;
  const s = (state.scores || {})[n] || {};
  ITEMS.forEach((k) => {
    if (s[k]) { const r = form.querySelector('input[name="' + k + '"][value="' + s[k] + '"]');
      if (r) r.checked = true; }
  });
  form.querySelector('textarea').value = s.note || '';
  form.addEventListener('input', () => {
    const entry = {};
    ITEMS.forEach((k) => {
      const r = form.querySelector('input[name="' + k + '"]:checked');
      if (r) entry[k] = Number(r.value);
    });
    entry.note = form.querySelector('textarea').value;
    state.scores = state.scores || {};
    state.scores[n] = entry;
    save(state);
    refresh();
  });
});
const scorer = document.getElementById('scorer');
scorer.value = state.scorer || '';
scorer.addEventListener('input', () => { state.scorer = scorer.value; save(state); });
document.getElementById('export').addEventListener('click', () => {
  const name = (state.scorer || '').trim() || 'user';
  const body = JSON.stringify({ page: PAGE, scorer: name, exported_at: new Date().toISOString(),
    scores: state.scores || {} }, null, 1);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  a.download = 'scores-' + name + '-' + PAGE + '.json';
  a.click();
});
refresh();
"""


def rubric_html(rubric: dict[str, Any]) -> str:
    parts = [f"<details class='rubric'><summary><b>루브릭</b></summary><p>{e(rubric['scale'])}</p>"]
    for item in rubric["items"]:
        parts.append(f"<h4>{e(item['name'])}</h4><p class='muted'>{e(item['question'])}</p>")
        parts.append("<dl class='anchors'>")
        for point in ("5", "3", "1"):
            parts.append(f"<dt>{point}점</dt><dd>{e(item['anchors'][point])}</dd>")
        parts.append("</dl>")
    return "".join(parts) + "</details>"


def form_html(number: str, rubric: dict[str, Any]) -> str:
    rows = []
    for item in rubric["items"]:
        anchors = " / ".join(f"{p}점: {item['anchors'][p]}" for p in ("1", "3", "5"))
        radios = "".join(
            f"<label><input type='radio' name='{item['key']}' value='{p}'> {p}</label>"
            for p in range(1, 6)
        )
        rows.append(
            f"<div class='item' title='{e(anchors)}'><b>{e(item['name'])}</b><span>{radios}"
            f"</span><span class='q'>{e(item['question'])}</span></div>"
        )
    return (
        f"<form class='score' data-bundle='{number}' onsubmit='return false'>"
        f"<h3>채점</h3>{''.join(rows)}<textarea placeholder='메모 (선택)'></textarea></form>"
    )


def bundle_html(number: str, record: dict[str, Any], rubric: dict[str, Any]) -> str:
    episode = record["episode"]
    out = [f"<section class='bundle' id='b{number}'><h2>묶음 {number} · {e(episode['name'])}</h2>"]
    out.append(
        f"<p><b>주제</b> {e(episode['theme'])}<br><b>시놉시스</b> {e(episode['synopsis'])}</p>"
    )
    out.append("<table class='stages'>")
    for stage in episode["structure"]["stages"]:
        out.append(
            f"<tr><td><b>{e(stage['name'])}</b></td><td>긴장&nbsp;{stage['tension']}</td>"
            f"<td>{e(stage['summary'])}</td></tr>"
        )
    out.append("</table>")
    out.append(
        f"<p class='muted'>심는 복선: {e(', '.join(episode['plants']) or '없음')} · "
        f"회수하는 복선: {e(', '.join(episode['payoffs']) or '없음')}</p>"
    )
    plan = record.get("plan")
    if plan is None:
        out.append("<p class='failed'>연출 실패: 이 묶음은 채점하지 않습니다.</p></section>")
        return "".join(out)
    for chapter in plan["chapters"]:
        out.append(f"<h3>{chapter['chapter']}화 · {chapter['target_chars']}자</h3>")
        for scene in chapter["scenes"]:
            out.append(
                f"<div class='scene'><h4>장면 {scene['scene']} "
                f"<span class='muted'>단계 {e(scene['source'])} · {scene['target_chars']}자</span>"
                f"</h4><p>{e(scene['summary'])}<br><b>핵심</b> {e(scene['core'])}<br>"
                f"<b>공개</b> {e(' / '.join(scene['reveal']) or '없음')}<br>"
                f"<b>고른 카드</b> {e(card_names(record, scene['chosen']))}</p>"
            )
            if scene["beats"]:
                out.append(
                    "<table class='beats'><tr><th>#</th><th>시점 · 서술 · 초점 · 밀도</th>"
                    "<th>긴장</th><th>분량</th><th>기법</th><th>요약</th></tr>"
                )
                for beat in scene["beats"]:
                    how = " · ".join(e(beat[key]) for key in MODE_FOCUS)
                    out.append(
                        f"<tr><td class='n'>{beat['order']}</td><td class='n'>{how}</td>"
                        f"<td class='n'>{beat['tension']}</td>"
                        f"<td class='n'>{beat['target_chars']}</td>"
                        f"<td class='n'>{e(card_names(record, beat['techniques']))}</td>"
                        f"<td>{e(beat['summary'])}</td></tr>"
                    )
                out.append("</table>")
            else:
                out.append("<p class='failed'>이 장면은 연출되지 않았습니다.</p>")
            out.append("</div>")
    cards = record.get("techniques", {})
    if cards:
        out.append("<details><summary><b>이 묶음의 카드</b></summary><ul>")
        for card in cards.values():
            out.append(
                f"<li><b>{e(card['name'])}</b>: {e(card['description'])}"
                f"<br><span class='muted'>적용: {e(card['mechanism'])}</span></li>"
            )
        out.append("</ul></details>")
    out.append(form_html(number, rubric))
    out.append("</section>")
    return "".join(out)


def page_html(page: str, bundles: list[tuple[str, dict[str, Any]]], rubric: dict[str, Any]) -> str:
    links = "".join(
        f"<a href='#b{n}'{' data-failed' if r.get('plan') is None else ''}>{n}</a>"
        for n, r in bundles
    )
    items = e(json.dumps([item["key"] for item in rubric["items"]]))
    body = "".join(bundle_html(n, r, rubric) for n, r in bundles)
    return (
        "<!doctype html><html lang='ko'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width, initial-scale=1'>"
        f"<title>연출 채점</title><style>{STYLE}</style></head>"
        f"<body data-page='{page}' data-items='{items}'><header><h1>연출 채점</h1>"
        "<label>채점자 <input id='scorer' size='10'></label>"
        "<span id='progress'></span><button id='export' type='button'>JSON 내보내기</button>"
        f"<nav>{links}</nav></header><main>{rubric_html(rubric)}{body}</main>"
        f"<script>{SCRIPT}</script></body></html>"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("run", type=Path)
    parser.add_argument("--dir", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=SEED)
    args = parser.parse_args()

    run = json.loads(args.run.read_text(encoding="utf-8"))
    rubric = json.loads(RUBRIC.read_text(encoding="utf-8"))
    records = list(run["episodes"])
    random.Random(args.seed).shuffle(records)
    bundles = [(f"{i:02d}", record) for i, record in enumerate(records, start=1)]
    key = {
        n: {"episode": r["id"], "genre": r["genre"], "scored": r.get("plan") is not None}
        for n, r in bundles
    }
    page = hashlib.sha256(json.dumps(key, sort_keys=True).encode()).hexdigest()[:8]

    args.dir.mkdir(parents=True, exist_ok=True)
    (args.dir / "bundles.html").write_text(page_html(page, bundles, rubric), encoding="utf-8")
    md = [f"# 연출 채점 묶음 (page {page})", ""]
    for n, record in bundles:
        md += bundle_md(n, record)
    (args.dir / "bundles.md").write_text("\n".join(md), encoding="utf-8")
    meta = {"page": page, "run": str(args.run), "seed": args.seed, "fake": run.get("fake")}
    (args.dir / "key.json").write_text(
        json.dumps({**meta, "bundles": key}, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print(f"wrote {args.dir} (page {page}, {len(bundles)} bundles)")


if __name__ == "__main__":
    main()
