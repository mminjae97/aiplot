-- Where the reader stopped in a chapter (S3-3, §16 PATCH /chapters/{chapterId}): the share of
-- its text scrolled past, so 이어 읽기 opens the first unread chapter there.

ALTER TABLE chapter ADD COLUMN position REAL NOT NULL DEFAULT 0
    CHECK (position >= 0 AND position <= 1);
