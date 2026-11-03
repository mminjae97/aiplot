# Step 2: technique choice evaluation

Pass criteria (CLAUDE.md §20 step 2): over 20 scenes, the right technique is within the
narrowed candidates ≥90% and within the recommendations ≥80%; when `pick` gives a scene a
single recommendation, that one must hold it.

## Cases

`cases/{genre}.json`, the six unit 15 worlds (fantasy, hunter, romance, wuxia, mystery, scifi).

- `seeds`: the unit 15 case file whose seed cards (main story, part 1, regions, characters,
  world) the episodes build on.
- `episodes`: complete episode cards of part 1 (structure, synopsis, characters, places,
  foreshadowing), 10 in all. Each has two scored stages in `gold`:
  - `stage`: the episode stage (§9 `source`) the scored scene comes from;
  - `accept`: the techniques that fit it. Any one of them counts as right;
  - `why`: what in the story calls for them, for the reviewer.

Accepted techniques are direction candidates only: scope 장면 or 회차, and never one of the
serial cards `direct` always gets (회차 끝 절단, 회차 3단 설계, 전회 연결 도입, 사이다/고구마 완급).
Each scored stage is written so the story itself calls for one family of techniques (a reader
who knows what a character does not, a stated deadline, a twist at the end, three years to pass,
a place revisited), across information, time, voice, dialogue, comedy and description.

`check.py` saves every genre's episodes with their seeds into a throwaway database through the
app's card save: each must come out complete, and every accepted technique must exist and be a
candidate.

## Scoring

The `scene` role splits an episode into scenes, each with its `source` stage. For a scored
stage, its scenes are those whose source is that stage (none = a miss on both counts).

- Candidates: right if any accepted technique is among the narrowed candidates of any of those
  scenes.
- Recommendations: right if any accepted technique is in any recommended combination for those
  scenes. When `pick` gives one of those scenes a single combination, that combination must hold
  an accepted technique.

## Review

Claude drafted the cases; they are reviewed in the PR before any run (the user asked for an
independent review). The runner and scorer come with the `scene` and `pick` roles.

## Check

```
uv run python eval/step2/check.py
```
