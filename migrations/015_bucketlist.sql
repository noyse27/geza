ALTER TABLE media ADD COLUMN IF NOT EXISTS bucketlist boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS media_bucketlist ON media(bucketlist) WHERE bucketlist;
INSERT INTO jobs(kind,dedupe_key,payload,available_at)
VALUES('plex-scan','plex-scan-daily','{}',
  ((date_trunc('day', now() AT TIME ZONE 'Europe/Berlin') + interval '1 day' + interval '3 hours') AT TIME ZONE 'Europe/Berlin'))
ON CONFLICT(dedupe_key) DO NOTHING;
