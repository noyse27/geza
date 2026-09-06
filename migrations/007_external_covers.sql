-- Plex artwork may contain personal overlays. Remove it and prioritize replacements.
INSERT INTO jobs(kind,dedupe_key,payload)
SELECT 'enrich','enrich:'||id,jsonb_build_object('mediaId',id) FROM media
WHERE field_sources->>'poster'='plex' OR poster LIKE '/api/posters/%'
ON CONFLICT(dedupe_key) DO UPDATE SET status='pending',attempts=0,available_at=now(),error=NULL;
UPDATE media SET poster=NULL,field_sources=field_sources-'poster',updated_at=now()
WHERE field_sources->>'poster'='plex' OR poster LIKE '/api/posters/%';
DELETE FROM posters;
