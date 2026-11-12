# Step 7: writing on the real model

Goal (CLAUDE.md §20 step 7): chapter length within ±10% of the target for ≥90% of the chapters;
a repeated run of three eojeol ≤3 per chapter. Contradictions and state come with the checks.

## Run

Start llama-server by hand with the base profile's GGUF and flags (§17), alone on the PC, then:

```
uv run python eval/step7/run_write.py --url http://127.0.0.1:8796 \
    --plans eval/results/step4/run1-all.json --out eval/results/step7/run1.json
uv run python eval/step7/score_write.py eval/results/step7/run1.json
```

`run_write.py` takes a step 4 run's plans (20 episodes, every scene directed), confirms them,
starts writing and has the app's chapter job write each chapter; `--episodes ID…` runs a
subset, `--fake` checks the scripts with the fixture client. It keeps every `write` call per
beat (target given, user message, text, finish reason, usage, seconds) and the stored text.
Experiments before a config change: `--sampling KEY=VALUE…` (e.g. `dry_multiplier=0.8`),
`--thinking`, `--max-tokens N`, `--previous-chars N`; the run records them.

`score_write.py` prints one line per chapter and the totals: chapters within ±10%, beat
characters against the given and the plan target (also by mode, focus, density), beats within
500–1000, beats written again, beats continued (§10: calls continuing a short beat, those
adding no new line, beats reaching 90% of their target), calls cut at max_tokens, repeated three-eojeol runs per chapter,
lines copied word for word from an earlier beat of the chapter,
tokens and seconds per call.

Not measured yet: summaries and state are not in the context (they come with their units).
