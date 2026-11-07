# Step 3: direction plan schema pass

Pass criterion (CLAUDE.md §20 step 3): schema pass ≥95% for each role's calls, `arrange` (one
per episode) and `direct` (one per scene).

## Cases

The step 2 cases (`eval/step2/cases`, README there): six genres, 10 complete episodes of part 1
on the unit 15 seed cards, loaded the same way (`check.py` there). No gold here: step 3 checks
that the plans come back in shape; their quality is step 4's rubric.

## Run

Start llama-server by hand with the base profile's GGUF and flags (§17), alone on the PC, then:

```
uv run python eval/step3/run_plan.py --url http://127.0.0.1:8796 --out eval/results/step3/run1.json
uv run python eval/step3/score_plan.py eval/results/step3/run1.json \
    --json eval/results/step3/score-run1.json --md eval/results/step3/report-run1.md
```

Per episode, the app's own code: `direction.split_scenes` → `direction.arrange_scenes` →
`direction.build_plan`; then, scene by scene in narration order, the first recommended card is
chosen (standing in for a user who takes the first recommendation; the user picked this for
step 3) and `direction.direct_scene` runs, its beats going back into the plan so the next scene
sees them. A scene with no recommended card is skipped (listed). `--episodes ID…` runs a subset
(PARTIAL RUN); `--fake` uses the fixture client (FAKE RUN: a check of the scripts; its 4-stage
episodes fail the scene call, as the fixture's scenes are 5-stage). Results are written after
every episode and stay out of git; a run without `finished_at` is an UNFINISHED RUN. Only a
full, real, finished run can pass.

## Scoring

A call passes when it returns a cleaned result: JSON valid for its narrowed schema within the
router's one retry, and something left after cleaning within its one more generation (§13).
Calls that failed on their output (LLM_INVALID_OUTPUT, LLM_OUTPUT_TRUNCATED) count against the
rate; any other failure (no server, a refused scene) is reported apart and fails the run.

Recorded for step 4 (no criterion): first-try passes, times and tokens against ctx 12288;
chapters per episode and beats per chapter (§1: 6–10); episodes told out of story order; scenes
whose chosen card a beat names; 전회 연결 도입 named in chapters' first scenes and 회차 끝 절단 in
their last scenes' last beats; point-of-view changes within a scene. The Markdown report lists
every plan (chapters, scenes with their card and reveals, beats) for the user to read.
