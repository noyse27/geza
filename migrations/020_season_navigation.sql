-- Older history exports may contain episodes without separate season records.
-- Create only structural records; ratings, reviews and Plex presence stay separate.
CREATE OR REPLACE FUNCTION ensure_known_seasons(show_id bigint DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE candidate record;
BEGIN
 FOR candidate IN
  SELECT DISTINCT e.parent_id,e.season FROM media e JOIN media p ON p.id=e.parent_id AND p.kind='show'
  WHERE e.kind='episode' AND e.season>=0 AND (show_id IS NULL OR e.parent_id=show_id)
   AND NOT EXISTS(SELECT 1 FROM media s WHERE s.kind='season' AND s.parent_id=e.parent_id AND s.season=e.season)
  ORDER BY e.parent_id,e.season
 LOOP
  PERFORM 1 FROM media WHERE id=candidate.parent_id FOR UPDATE;
  INSERT INTO media(kind,title,parent_id,season)
   SELECT 'season','Staffel '||candidate.season,candidate.parent_id,candidate.season
   WHERE NOT EXISTS(SELECT 1 FROM media s WHERE s.kind='season' AND s.parent_id=candidate.parent_id AND s.season=candidate.season);
 END LOOP;
END $$;
SELECT ensure_known_seasons();
SELECT rumpel_refresh(NULL);
