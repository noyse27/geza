ALTER TABLE media ADD COLUMN IF NOT EXISTS bucketlist boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS media_bucketlist ON media(bucketlist) WHERE bucketlist;
