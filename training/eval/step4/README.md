# Step 4: direction rubric eval set

Goal (CLAUDE.md §20 step 4): 20 bundles scored 1–5 on tension placement, chapter cut, reveal
timing, POV consistency and technique fit. No pass number: the scores are the baseline of the
prompt-only direction.

## Bundles

A bundle is one episode's direction plan as the app makes it: `scene` → `arrange` → `direct`
for each scene in narration order, the first recommended card chosen per scene (as in step 3).

The 20 episodes:

- the 10 step 2 cases (`eval/step2/cases`, part 1 of the six unit 15 worlds);
- 10 new ones in `cases/{genre}.json`, continuing the same works: fantasy 1, hunter 1,
  romance 2, wuxia 2, mystery 2, scifi 2 (3–4 per genre). Each file names its step 2 case as
  `base`; its episodes are saved after the base's, so they may link to and pay off what the base
  episodes plant. Three sit in part 2 (romance 4, wuxia 3–4), the rest continue part 1.

The new episodes vary what the rubric looks at: a secret the reader shares with one character
(fantasy 3, hunter 3, wuxia 4), cross-cutting to what the protagonist cannot see (wuxia 4,
scifi 3 from the AI's side), a confession or reveal at the climax (fantasy 3, mystery 2), a
character who knew all along (wuxia 3, romance 4), comedy before a near-discovery (romance 3),
a protagonist who forgets what the reader remembers (mystery 3).

`check_cases.py` saves each genre's base and new episodes through the app's card save, as
`eval/step2/check.py` does: every card complete, every reference resolved to its relation row,
new ids unused by the base, stage names exactly 기승전결 or 발단…결말, 20 episodes in all, and
the rubric's five items with 1/3/5 anchors. CI runs it.

## Rubric

`rubric.json` (Korean: the scoring page shows it): per item a question and anchors for 1, 3 and
5 (2 and 4 lie between). One score per item per bundle; the episode's stages, tension and
foreshadowing are the reference, the scenes, chapters and beats are what is scored.

## Run

Start llama-server by hand with the base profile's GGUF and flags (§17), alone on the PC, then:

```
uv run python eval/step4/run_bundles.py --url http://127.0.0.1:8796 --out eval/results/step4/run1.json
uv run python eval/step4/make_page.py eval/results/step4/run1.json --dir eval/results/step4/run1
```

`run_bundles.py` loads each genre (`check_cases.load_genre`) into a throwaway database and runs
step 3's per-episode runner (`eval/step3/run_plan.py`: `scene`, `arrange`, `build_plan`, then
`direct` scene by scene in narration order with the first recommended card), keeping beside each
plan the episode as saved and the text of the cards the plan names. `--fake` runs the fixture
client (a check of the scripts: its 4-stage episodes fail the scene call), `--episodes ID…` a
subset. Results stay out of git (eval/results/ is gitignored).

## Scoring

`make_page.py` writes, into `--dir`:

- `bundles.html`: one self-contained page, the bundles in a shuffled order (seed 4) as 묶음
  01…20. Blind: no episode id, genre, run, prompt version, time or token count. A bundle shows
  the episode (theme, synopsis, stages with tension, foreshadowing planted and paid off), its
  chapters with their scenes in narration order (summary, core, reveals, chosen cards) and beats
  (POV, mode, focus, density, tension, chars, cards, summary), and the cards' description and
  mechanism; then the five items as radio buttons 1–5 (the anchors on hover, the full rubric at
  the top) and a note. Scores stay in the browser (localStorage, per page) and leave it only by
  "JSON 내보내기" as `scores-{scorer}-{page}.json`. A bundle whose plan failed is struck out
  in the number bar and has no form.
- `bundles.md`: the same bundles as text, for Claude to score apart, written by hand as the
  same JSON (`"scorer": "claude"`), before reading the user's scores.
- `key.json`: bundle number → episode id, genre and whether it can be scored. Not for scorers.

```
uv run python eval/step4/score_bundles.py eval/results/step4/run1/key.json \
    eval/results/step4/run1/scores-*.json \
    --json eval/results/step4/score-run1.json --md eval/results/step4/report-run1.md
```

Per scorer: each item's mean over the bundles it scored completely, overall and per genre, and
the scorable bundles it left incomplete. With two scorers, per item over the bundles both
scored: exact agreement, within one point, mean absolute difference and quadratic weighted
kappa. Then every bundle's scores and the notes. No pass number: the scores are the baseline.

## Review

Claude drafted the new episodes and the rubric; the user reviews them in the PR before any run.
