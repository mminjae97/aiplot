-- Direction technique cards (§9, §14): shared across works, loaded from server/data/techniques
-- at every server start (services/techniques.sync). data holds the card's other fields; the
-- tag and relation tables mirror them for narrowing candidates and checking combinations.

CREATE TABLE technique_card (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    data TEXT NOT NULL CHECK (json_valid(data))
);

CREATE TABLE technique_tag (
    technique_id TEXT NOT NULL REFERENCES technique_card (id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('scope', 'effect', 'situation')),
    tag TEXT NOT NULL,
    PRIMARY KEY (technique_id, kind, tag)
);

CREATE INDEX technique_by_tag ON technique_tag (kind, tag);

-- pairs: as the card lists them. conflicts: both directions (a pair conflicts if either card
-- lists the other).
CREATE TABLE technique_relation (
    from_id TEXT NOT NULL REFERENCES technique_card (id) ON DELETE CASCADE,
    to_id TEXT NOT NULL REFERENCES technique_card (id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('pairs', 'conflicts')),
    PRIMARY KEY (from_id, to_id, kind)
);
