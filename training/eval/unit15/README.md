# Step 1 unit 15: card generation evaluation

Pass criteria (CLAUDE.md §20 step 1): card field match ≥85% (36 notes, 6 per type);
unsupported fills ≤5%; JSON valid 100% with one retry; similar names ≥90% found, ≤10% false;
chat first char ≤2s; real token counts measured.

## Cases

`cases/{genre}.json`, six genres (fantasy, hunter, romance, wuxia, mystery, scifi), each with
one case per card type and four name checks.

- `seeds`: cards already in the work, saved into a throwaway database. Being in the database
  is not being seen: the card role sees only what the app gives it (draft_card.card_refs):
  the case's `refs` (@ cards), all world cards, and for a part the main story, for an episode
  the main story, its part and all regions. A case that needs another card (a relation, an
  origin region, a linked region, an episode's characters) @-mentions it in `refs`, as a writer
  would.
- `notes`: the source notes, one sentence per line.
- `gold`: one entry per scored field. Kinds: `exact` (same value), `ids` (same set of card ids;
  relations by target), `facts` / `items` (free text: the listed facts or list items are
  there), `empty` (not in the notes: filled without being marked AI 추정 = unsupported fill),
  `optional` (not scored).
- `names`: one chat line; `expect` lists the names the turn must flag as similar to an existing
  card (empty = must flag none).

Region link `direction` is where the linked region lies seen from this one (the map's reading,
app/src/components/regionLayout.ts).

## Review

The user asked Claude to review the cases instead of reviewing them: an independent reviewer
(a fresh agent) checked every case against the notes and the code that builds the prompt;
its findings were applied before the scored run (refs for unseen cards, link directions,
ambiguous fields made optional or accepting both answers, answer-key sentences dropped).

## Judging (facts / items)

Claude judges free-text fields against the gold, then the report shows every verdict for the
user to check. Rules:

- A fact counts when its meaning is there, in any wording.
- A fact may sit in a neighbouring field of the same card: traits / behaviors, summary /
  details, details / rules, behaviors / speech.description. It counts once, where it is.
- Stages: the notes' events in order, each in a stage it fits; the exact split between
  neighbouring stages is not scored.
- `unsupported`: the field states something the notes do not (invented facts), not merely a
  rewording or a fair summary.

## Run

```
llama-server -m {base gguf} -c 8192 -ctk f16 -ctv f16 --port 8796 -ngl 99 -fa on -np 1 --cache-ram 1024
uv run python eval/unit15/run.py --url http://127.0.0.1:8796 --out eval/results/unit15/run.json
uv run python eval/unit15/score.py eval/results/unit15/run.json \
    --judged eval/results/unit15/judged.json --html eval/results/unit15/report.html
```

Results (raw model output, judgements, reports) stay out of git (eval/.gitignore).
