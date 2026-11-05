-- Scene devices (§9, §14): technique_tag gains kind 'device'. SQLite cannot change a CHECK in
-- place, so the table is rebuilt; its rows are the catalog's, rewritten at every server start.

CREATE TABLE technique_tag_new (
    technique_id TEXT NOT NULL REFERENCES technique_card (id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('scope', 'effect', 'situation', 'device')),
    tag TEXT NOT NULL,
    PRIMARY KEY (technique_id, kind, tag)
);

INSERT INTO technique_tag_new (technique_id, kind, tag)
SELECT technique_id, kind, tag FROM technique_tag;

DROP TABLE technique_tag;

ALTER TABLE technique_tag_new RENAME TO technique_tag;

CREATE INDEX technique_by_tag ON technique_tag (kind, tag);
