-- Snapshots (§11, §14): a copy of the database taken before a stage is reopened, which deletes
-- the later stages' data. path is relative to {data}/snapshots.

CREATE TABLE snapshot (
    id INTEGER PRIMARY KEY,
    work_id TEXT NOT NULL REFERENCES work (id) ON DELETE CASCADE,
    stage INTEGER NOT NULL CHECK (stage IN (1, 2)),
    path TEXT NOT NULL,
    created_at TEXT NOT NULL
);
