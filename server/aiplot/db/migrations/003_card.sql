-- Stage 1 cards (§7, §14, §15). card.data holds the whole card as generated; the type tables
-- and relation tables mirror what other screens and later stages query (references come only
-- from relation tables, §6). Rows pointing at other cards are written by the save service,
-- which keeps them inside one work.

CREATE TABLE card (
    id TEXT PRIMARY KEY,
    work_id TEXT NOT NULL REFERENCES work (id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (
        type IN ('world', 'character', 'region', 'main_story', 'part', 'episode')
    ),
    name TEXT,
    source_notes TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL CHECK (json_valid(data)),
    evidence TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(evidence)),
    ai_guess TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(ai_guess)),
    pinned_fields TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(pinned_fields)),
    status TEXT NOT NULL CHECK (status IN ('complete', 'incomplete')),
    schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1)
);

CREATE INDEX card_by_work ON card (work_id, type);

-- Card names for @ autocomplete and quick open: prefix search (2 chars indexed for Korean).
CREATE VIRTUAL TABLE card_name USING fts5 (
    name,
    content = 'card',
    content_rowid = 'rowid',
    prefix = '1 2',
    tokenize = 'unicode61'
);

CREATE TRIGGER card_name_insert AFTER INSERT ON card BEGIN
    INSERT INTO card_name (rowid, name) VALUES (new.rowid, coalesce(new.name, ''));
END;

CREATE TRIGGER card_name_delete AFTER DELETE ON card BEGIN
    INSERT INTO card_name (card_name, rowid, name)
    VALUES ('delete', old.rowid, coalesce(old.name, ''));
END;

CREATE TRIGGER card_name_update AFTER UPDATE OF name ON card BEGIN
    INSERT INTO card_name (card_name, rowid, name)
    VALUES ('delete', old.rowid, coalesce(old.name, ''));
    INSERT INTO card_name (rowid, name) VALUES (new.rowid, coalesce(new.name, ''));
END;

-- Type tables: one row per card of that type.

CREATE TABLE world (
    card_id TEXT PRIMARY KEY REFERENCES card (id) ON DELETE CASCADE,
    category TEXT CHECK (category IN ('rule', 'faction', 'history', 'culture', 'other')),
    summary TEXT
);

CREATE TABLE character (
    card_id TEXT PRIMARY KEY REFERENCES card (id) ON DELETE CASCADE,
    theme TEXT,
    personality TEXT NOT NULL CHECK (json_valid(personality)),
    speech TEXT NOT NULL CHECK (json_valid(speech)),
    appearance_init TEXT,
    origin_region_id TEXT REFERENCES card (id) ON DELETE SET NULL
);

CREATE TABLE region (
    card_id TEXT PRIMARY KEY REFERENCES card (id) ON DELETE CASCADE,
    parent_region_id TEXT REFERENCES card (id) ON DELETE SET NULL,
    environment TEXT NOT NULL CHECK (json_valid(environment)),
    sensory TEXT NOT NULL CHECK (json_valid(sensory)),
    -- Set by the map (§8); NULL until placed.
    map_x REAL,
    map_y REAL
);

CREATE TABLE main_story (
    card_id TEXT PRIMARY KEY REFERENCES card (id) ON DELETE CASCADE,
    theme TEXT,
    premise TEXT,
    ending TEXT
);

CREATE TABLE part (
    card_id TEXT PRIMARY KEY REFERENCES card (id) ON DELETE CASCADE,
    main_id TEXT REFERENCES card (id) ON DELETE SET NULL,
    "order" INTEGER,
    start TEXT,
    "end" TEXT
);

CREATE TABLE worldline (
    id TEXT PRIMARY KEY,
    work_id TEXT NOT NULL REFERENCES work (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    branch_episode_id TEXT REFERENCES card (id) ON DELETE SET NULL
);

CREATE TABLE episode (
    card_id TEXT PRIMARY KEY REFERENCES card (id) ON DELETE CASCADE,
    part_id TEXT REFERENCES card (id) ON DELETE SET NULL,
    "order" INTEGER,
    structure TEXT CHECK (structure IS NULL OR json_valid(structure)),
    worldline_id TEXT REFERENCES worldline (id) ON DELETE SET NULL,
    -- Written in stage 3 (§10).
    summary TEXT
);

CREATE INDEX episode_by_part ON episode (part_id, "order");

-- Relation tables: every reference between cards.

CREATE TABLE milestone (
    id TEXT PRIMARY KEY,
    main_id TEXT NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    "order" INTEGER NOT NULL,
    text TEXT NOT NULL
);

CREATE TABLE milestone_fill (
    milestone_id TEXT NOT NULL REFERENCES milestone (id) ON DELETE CASCADE,
    -- A part or an episode.
    card_id TEXT NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    PRIMARY KEY (milestone_id, card_id)
);

CREATE TABLE region_link (
    from_id TEXT NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    to_id TEXT NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    -- Evidence for the impossible-travel check (§7); all NULL when unknown.
    travel_value REAL CHECK (travel_value > 0),
    travel_unit TEXT CHECK (travel_unit IN ('minute', 'hour', 'day')),
    travel_mode TEXT,
    direction TEXT,
    PRIMARY KEY (from_id, to_id)
);

CREATE TABLE char_relation (
    from_id TEXT NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    to_id TEXT NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    relation TEXT NOT NULL,
    PRIMARY KEY (from_id, to_id)
);

CREATE TABLE world_relation (
    world_id TEXT NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    -- A character, region or world card.
    card_id TEXT NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    PRIMARY KEY (world_id, card_id)
);

CREATE TABLE episode_character (
    episode_id TEXT NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    PRIMARY KEY (episode_id, card_id)
);

CREATE TABLE episode_region (
    episode_id TEXT NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    -- 1 = locations.main (at most one per episode), 0 = locations.others.
    main INTEGER NOT NULL DEFAULT 0 CHECK (main IN (0, 1)),
    PRIMARY KEY (episode_id, card_id)
);

CREATE UNIQUE INDEX episode_region_one_main ON episode_region (episode_id) WHERE main = 1;

CREATE TABLE episode_world (
    episode_id TEXT NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    PRIMARY KEY (episode_id, card_id)
);

CREATE TABLE episode_link (
    -- order: from comes right before to; cause: from causes to.
    from_id TEXT NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    to_id TEXT NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('order', 'cause')),
    PRIMARY KEY (from_id, to_id, kind)
);

CREATE INDEX episode_link_to ON episode_link (to_id, kind);

CREATE TABLE foreshadowing (
    id TEXT PRIMARY KEY,
    plant_episode_id TEXT NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    payoff_episode_id TEXT REFERENCES card (id) ON DELETE SET NULL,
    text TEXT NOT NULL
);
