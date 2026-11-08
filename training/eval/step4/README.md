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

## Scoring

Blind: the scoring page shows a bundle's episode (synopsis, stages with tension, foreshadowing),
its chapters with their scenes (summary, core, reveals, chosen cards) and beats (summary, POV,
mode, focus, density, tension, cards), and the cards' description, never the run, prompt
versions or times. The user scores on a local HTML page (scores kept in the browser, exported
as JSON); Claude scores the same bundles apart; the report gives both and their agreement.

The run script, scoring page and report come in unit 4-2.

## Review

Claude drafted the new episodes and the rubric; the user reviews them in the PR before any run.
