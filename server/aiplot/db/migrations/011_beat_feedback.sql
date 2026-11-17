-- The user's 좋음/별로 on a beat version with a note (§9, §14): training feedback (§18), kept
-- on the version so it stays with the text it was given on.

ALTER TABLE beat_version ADD COLUMN feedback TEXT CHECK (feedback IN ('good', 'bad'));
ALTER TABLE beat_version ADD COLUMN feedback_note TEXT
    CHECK (feedback_note IS NULL OR feedback IS NOT NULL);
