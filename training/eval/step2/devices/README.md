# Scene devices (§9)

The fixed device list (`schemas/technique/technique-device.json`) and every card's `devices` in
`server/data/techniques/` were made by an agent that read only the cards' definition, use_when,
avoid_when and requires (the 267 direction candidates), never these eval cases. The 53 cards
that are never candidates (sentence-only, arc- or work-only, serial) got `[]`, as did 67
candidates with no scene device.

- `vocab.json`: each device's key, Korean name (the app's reason words) and yes/no question
  (the scene prompt's).
- `stages-claude.json`: a second agent's devices for every stage of the eval episodes, from
  the episode text alone, without the gold techniques: an upper bound for the scene role.

Ranking candidates by shared devices, ties by the step 2 runs' scene tags, put the right card
in the top 5 for 16–18 of 20 stages with these labels; the 8B answering all 41 questions per
stage (7.5 yes per stage against 3.1 here) got 9–12 (CLAUDE.md §20).
