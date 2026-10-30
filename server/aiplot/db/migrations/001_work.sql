-- Books in the library (§14 work). Cards, plans and chapters reference work(id) later.
CREATE TABLE work (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
    stage INTEGER NOT NULL DEFAULT 1 CHECK (stage IN (1, 2, 3)),
    locked_stage INTEGER NOT NULL DEFAULT 0 CHECK (locked_stage IN (0, 1, 2)),
    last_item TEXT CHECK (
        last_item IN ('world', 'characters', 'regions', 'story', 'direction', 'writing', 'reading')
    ),
    updated_at TEXT NOT NULL
);

CREATE INDEX work_by_updated ON work (updated_at DESC);
