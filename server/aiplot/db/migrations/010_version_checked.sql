-- Whether a beat version's check is over (§10): set with the check's state records and warnings,
-- also when the check left a check_failed warning. A version whose job stopped before that stays
-- unchecked: the screen shows it so, and saving its text again checks it.

ALTER TABLE beat_version ADD COLUMN checked INTEGER NOT NULL DEFAULT 0 CHECK (checked IN (0, 1));
