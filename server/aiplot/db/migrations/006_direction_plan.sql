-- Direction plans (§9, §14): one per episode, the plan JSON holding chapters, scenes and
-- beats with each scene's status. technique_pick mirrors each scene's recommended and chosen
-- cards (rank null = a card the user added). technique_id has no foreign key: the catalog is
-- rewritten from the data files at every server start, and a card dropped from it must not
-- take the user's picks with it.

CREATE TABLE direction_plan (
    id TEXT PRIMARY KEY,
    episode_id TEXT NOT NULL UNIQUE REFERENCES card (id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('directing', 'confirmed')),
    plan TEXT NOT NULL CHECK (json_valid(plan))
);

CREATE TABLE technique_pick (
    id INTEGER PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES direction_plan (id) ON DELETE CASCADE,
    scene INTEGER NOT NULL CHECK (scene >= 1),
    rank INTEGER CHECK (rank >= 1),
    technique_id TEXT NOT NULL,
    matched TEXT NOT NULL CHECK (json_valid(matched)),
    chosen INTEGER NOT NULL CHECK (chosen IN (0, 1)),
    UNIQUE (plan_id, scene, technique_id)
);
