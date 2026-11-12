-- What the check role makes of a written beat (§7, §10, §14): the state it left its characters
-- in, and warnings on the version it read. A beat written again replaces its state records; its
-- warnings stay with the version they were made on. Both go with the manuscript (a reopen
-- deletes the chapters).

CREATE TABLE state_record (
    id INTEGER PRIMARY KEY,
    beat_id TEXT NOT NULL REFERENCES beat (id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    key TEXT NOT NULL CHECK (
        key IN ('location', 'injury', 'item', 'knows_secret', 'relation_change', 'appearance_change')
    ),
    value TEXT NOT NULL
);

CREATE INDEX state_record_beat ON state_record (beat_id);
CREATE INDEX state_record_card ON state_record (card_id);

-- sentence = the 1-based number of the sentence in the version's text, null when the warning
-- is about no one sentence. card_id = the evidence card, if any. ignore_reason = why the user
-- ignored it (later checks are told).
CREATE TABLE warning (
    id TEXT PRIMARY KEY,
    version_id INTEGER NOT NULL REFERENCES beat_version (id) ON DELETE CASCADE,
    card_id TEXT REFERENCES card (id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (
        kind IN (
            'character', 'appearance', 'travel', 'state', 'world_rule', 'banned_phrase',
            'check_failed'
        )
    ),
    sentence INTEGER CHECK (sentence >= 1),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'ignored')),
    reason TEXT NOT NULL,
    ignore_reason TEXT
);

CREATE INDEX warning_version ON warning (version_id);
