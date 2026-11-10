-- The manuscript (§10, §14): chapters and beats made from the confirmed direction plans when
-- writing starts, and each beat's text as versions (the latest is the current one). A beat
-- keeps what the write role needs of its plan beat: the scene it belongs to, the instruction
-- (summary) and its target. technique_id has no foreign key: the catalog is rewritten from the
-- data files at every server start.

CREATE TABLE chapter (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES direction_plan (id) ON DELETE CASCADE,
    work_id TEXT NOT NULL REFERENCES work (id) ON DELETE CASCADE,
    number INTEGER NOT NULL CHECK (number >= 1),
    target_chars INTEGER NOT NULL CHECK (target_chars >= 1),
    read INTEGER NOT NULL DEFAULT 0 CHECK (read IN (0, 1)),
    progress_summary TEXT,
    summary_long TEXT,
    summary_short TEXT
);

-- Not unique: numbering per worldline (§7) would repeat numbers within a work.
CREATE INDEX chapter_work_number ON chapter (work_id, number);
CREATE INDEX chapter_plan ON chapter (plan_id);

CREATE TABLE beat (
    id TEXT PRIMARY KEY,
    chapter_id TEXT NOT NULL REFERENCES chapter (id) ON DELETE CASCADE,
    "order" INTEGER NOT NULL CHECK ("order" >= 1),
    scene INTEGER NOT NULL CHECK (scene >= 1),
    source_stage TEXT NOT NULL,
    summary TEXT NOT NULL,
    pov TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('장면화', '요약')),
    focus TEXT NOT NULL CHECK (focus IN ('감정', '행동', '정보')),
    density TEXT NOT NULL CHECK (density IN ('담백', '자세히')),
    tension INTEGER NOT NULL CHECK (tension BETWEEN 1 AND 5),
    target_chars INTEGER NOT NULL CHECK (target_chars >= 1),
    UNIQUE (chapter_id, "order")
);

CREATE TABLE beat_technique (
    beat_id TEXT NOT NULL REFERENCES beat (id) ON DELETE CASCADE,
    technique_id TEXT NOT NULL,
    PRIMARY KEY (beat_id, technique_id)
);

CREATE TABLE beat_version (
    id INTEGER PRIMARY KEY,
    beat_id TEXT NOT NULL REFERENCES beat (id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK (version >= 1),
    text TEXT NOT NULL,
    chars INTEGER NOT NULL CHECK (chars >= 0),
    origin TEXT NOT NULL CHECK (origin IN ('generated', 'edited')),
    prompt_version INTEGER,
    style_id TEXT,
    style_version INTEGER,
    created_at TEXT NOT NULL,
    UNIQUE (beat_id, version)
);
