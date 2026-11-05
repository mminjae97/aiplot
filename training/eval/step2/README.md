# Step 2: technique choice evaluation

Pass criterion (CLAUDE.md §20 step 2): over 20 scenes, the right technique is within the 5
cards code recommends ≥80%. (Runs 1–8 measured the earlier design: 20 narrowed candidates and
the `pick` role's combinations.)

## Cases

`cases/{genre}.json`, the six unit 15 worlds (fantasy, hunter, romance, wuxia, mystery, scifi).

- `seeds`: the unit 15 case file whose seed cards (main story, part 1, regions, characters,
  world) the episodes build on.
- `complete_seeds`: per seed id, fields merged into that seed's data so it is complete. The
  unit 15 characters give only theme and traits, and an incomplete card is inactive (§11), so
  `scene` would see no characters. Here they get speech and appearance as well (`scene` reads
  only theme and traits). The unit 15 files stay unchanged.
- `episodes`: complete episode cards of part 1 (structure, synopsis, characters, places,
  foreshadowing), 10 in all. Each has two scored stages in `gold`:
  - `stage`: the episode stage (§9 `source`) the scored scene comes from;
  - `accept`: the techniques that fit it. Any one of them counts as right;
  - `why`: what in the story calls for them, for the reviewer.

Accepted techniques are direction candidates only: scope 장면 or 회차, and never one of the
serial cards `direct` always gets (`SERIAL_TECHNIQUES` in `server/aiplot/services/direction.py`:
회차 끝 절단, 회차 3단 설계, 사이다/고구마 완급, 전회 연결 도입).
Each scored stage is written so the story itself calls for one family of techniques (a reader
who knows what a character does not, a stated deadline, a twist at the end, three years to pass,
a place revisited), across information, time, voice, dialogue, comedy and description.

`check.py` saves every genre's episodes with their completed seeds into a throwaway database
through the app's card save, twice (so a reference to an episode later in the file resolves):
every seed card and every episode must come out complete, every id it references (part, characters, world, places, prev/next/causes,
fulfilled milestones, foreshadowing payoffs) must come out as its relation row (a seed card,
another case episode, a milestone or a foreshadowing another case episode plants), and every
accepted technique must exist and be a candidate. CI runs it.

## Scoring

The `scene` role splits an episode into scenes, each with its `source` stage. For a scored
stage, its scenes are those whose source is that stage (none = a miss).

- Recommended: right if any accepted technique is among the 5 cards `direction.recommend` gives
  any of those scenes (§9: most shared devices, then most shared tags, then id).
- Top 20 (reported, not a criterion): the same over the first 20 of that ranking.

## Run

Start llama-server by hand with the base profile's GGUF and flags (§17), alone on the PC (a
run next to other heavy work was once stopped by low system RAM), then:

```
uv run python eval/step2/run_direction.py --url http://127.0.0.1:8796 --out eval/results/step2/run9.json
uv run python eval/step2/score_direction.py eval/results/step2/run9.json     --json eval/results/step2/score-run9.json --md eval/results/step2/report-run9.md
```

`run_direction.py` builds each genre's database as `check.py` does (completed seeds, episodes,
the technique catalog) and calls the app's own code per episode: `direction.split_scenes`, then
for every scene `direction.recommend` (no model call) and the first 20 of the same ranking.
`--episodes ID…` runs a subset (scored as a PARTIAL RUN);
`--fake` uses the fixture client (a check of the scripts, scored as a FAKE RUN). Results are
written after every episode and stay out of git; a run that stopped early (no `finished_at`) is
an UNFINISHED RUN. Only a full, real, finished run can pass.

The scorer also reports, to set the highlight rule (§9), how many devices the recommended
right cards and the other recommended cards share with their scene and how the current rule
splits them; devices answered yes per scene; scene call failures, retries, times and token
counts (prompt + completion against ctx 12288). The Markdown report lists every scored stage
with its scenes (devices, tags), the accepted techniques' ranks in the first 20 and the 5
recommended cards with what they share, for the user.

## Review

Claude drafted the cases; they are reviewed in the PR before any run (the user asked for an
independent review).

## Check

```
uv run python eval/step2/check.py
```
