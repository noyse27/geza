-- Product decision: reviews and personal star ratings are public;
-- watch state, timestamps, repeats and history remain private.
ALTER TABLE reviews ALTER COLUMN is_public SET DEFAULT true;
UPDATE reviews SET is_public=true WHERE source='trakt';
