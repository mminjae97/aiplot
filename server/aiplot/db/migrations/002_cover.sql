-- 책 꾸미기 (§12 S0): book colour and uploaded cover illustrations. Files live in
-- {data}/images; path is relative to it.
CREATE TABLE work_cover (
    id TEXT PRIMARY KEY,
    work_id TEXT NOT NULL REFERENCES work (id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX work_cover_by_work ON work_cover (work_id, created_at);

-- NULL = the app's default colour, stable per work id.
ALTER TABLE work ADD COLUMN color TEXT CHECK (color GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]');

-- NULL = cloth cover. The service keeps it to one of the work's own covers.
ALTER TABLE work ADD COLUMN cover_id TEXT REFERENCES work_cover (id) ON DELETE SET NULL;
