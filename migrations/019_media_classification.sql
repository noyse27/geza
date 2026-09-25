-- Preserve explicit wishes and provenance separately from derived display flags.
ALTER TABLE media ADD COLUMN origins text[] NOT NULL DEFAULT '{}';
ALTER TABLE media ADD COLUMN seen_sources text[] NOT NULL DEFAULT '{}';
ALTER TABLE media ADD COLUMN bucket_preference text NOT NULL DEFAULT 'auto'
  CHECK(bucket_preference IN ('auto','include','exclude'));
ALTER TABLE media ADD COLUMN plex_watched boolean;
ALTER TABLE media ADD COLUMN plex_automatic boolean NOT NULL DEFAULT false;
ALTER TABLE media ADD COLUMN assignment_reason text NOT NULL DEFAULT 'Noch nicht eingeordnet';
-- Legacy automatic wishes remain until the first complete scan can replace them.
UPDATE media SET bucket_preference='include' WHERE bucketlist AND (manual_entry OR bucketlist_pinned);
UPDATE media SET origins=ARRAY['manual'] WHERE manual_entry OR bucketlist_pinned;
UPDATE media SET origins=ARRAY['legacy-bucket'] WHERE bucketlist AND bucket_preference='auto';

CREATE OR REPLACE FUNCTION rumpel_refresh(roots bigint[]) RETURNS void LANGUAGE plpgsql AS $$
DECLARE previous text := COALESCE(current_setting('geza.classifying',true),'');
BEGIN
 PERFORM set_config('geza.classifying','on',true);
 WITH RECURSIVE tree AS (
  SELECT id,id AS root_id FROM media WHERE CASE WHEN roots IS NULL THEN parent_id IS NULL ELSE id=ANY(roots) END
  UNION ALL SELECT c.id,t.root_id FROM media c JOIN tree t ON c.parent_id=t.id
 ), facts AS (
  SELECT m.*,t.root_id,
   (cardinality(m.seen_sources)>0 OR m.plex_watched IS TRUE OR EXISTS(SELECT 1 FROM watches w WHERE w.media_id=m.id)) AS seen,
   (EXISTS(SELECT 1 FROM ratings r WHERE r.media_id=m.id)
    OR EXISTS(SELECT 1 FROM reviews r WHERE r.media_id=m.id)
    OR EXISTS(SELECT 1 FROM friend_reviews r WHERE r.media_id=m.id AND r.manual)
    OR EXISTS(SELECT 1 FROM film_series_members r WHERE r.media_id=m.id)) AS activity
  FROM tree t JOIN media m ON m.id=t.id
 ), root_flags AS (
  SELECT root_id,bool_or(seen) AS root_seen,bool_or(seen OR activity) AS root_active,
   max(bucket_preference) FILTER(WHERE id=root_id) AS root_preference FROM facts GROUP BY root_id
 ), season_flags AS (
  SELECT root_id,season,bool_or(seen) AS seen FROM facts WHERE kind='episode' GROUP BY root_id,season
 ), flags AS (
  SELECT f.*,
   r.root_seen,r.root_active,r.root_preference,(f.seen OR COALESCE(s.seen,false)) AS season_seen
  FROM facts f JOIN root_flags r USING(root_id) LEFT JOIN season_flags s ON s.root_id=f.root_id AND s.season=f.season
 ), wishes AS (
  SELECT f.*,
   CASE WHEN kind='episode' OR bucket_preference='exclude' THEN false
    WHEN CASE WHEN kind='show' THEN root_seen WHEN kind='season' THEN season_seen ELSE seen END THEN false
    WHEN bucket_preference='include' THEN true
    WHEN 'trakt-watchlist'=ANY(origins) OR 'collection-wish'=ANY(origins) OR 'legacy-bucket'=ANY(origins) THEN true
    WHEN plex_automatic AND cardinality(plex_libraries)>0 AND plex_watched IS FALSE
     THEN kind='movie' OR kind='show' OR (kind='season' AND root_seen AND root_preference<>'exclude')
    ELSE false END AS wanted
  FROM flags f
 ), resolved AS (
  SELECT w.*, (w.wanted AND (w.kind<>'season' OR NOT COALESCE(s.wanted,false))) AS target_bucket
  FROM wishes w LEFT JOIN wishes s ON s.id=w.root_id
 ), desired AS (
  SELECT r.*, (NOT root_active AND NOT bool_or(target_bucket) OVER(PARTITION BY root_id)) AS target_rumpel,
   CASE WHEN target_bucket AND bucket_preference='include' THEN 'Manuell auf der Bucketliste'
    WHEN target_bucket AND 'trakt-watchlist'=ANY(origins) THEN 'Trakt Watchlist'
    WHEN target_bucket AND 'collection-wish'=ANY(origins) THEN 'Wunsch laut Trakt Collection'
    WHEN target_bucket AND 'legacy-bucket'=ANY(origins) THEN 'Bestehende Bucketliste; Plex-Abgleich ausstehend'
    WHEN target_bucket THEN 'In Plex vorhanden; keine Episode beziehungsweise kein Film gesehen'
    WHEN root_seen THEN 'Sichtung belegt'
    WHEN root_active THEN 'Eigene Aktivität vorhanden'
    WHEN bucket_preference='exclude' THEN 'Manuell aus der Bucketliste ausgeschlossen'
    WHEN plex_checked_at IS NULL THEN 'Keine Aktivität; Plex-Prüfung ausstehend'
    WHEN cardinality(plex_libraries)=0 THEN 'Keine Aktivität; beim letzten Abgleich nicht in Plex'
    ELSE 'In Plex; automatische Einordnung aus oder Gesehenstatus unbekannt' END AS reason
  FROM resolved r
 )
 UPDATE media m SET bucketlist=d.target_bucket,rumpel=d.target_rumpel,
   bucketlist_pinned=(d.target_bucket AND d.bucket_preference='include'),assignment_reason=d.reason
 FROM desired d WHERE m.id=d.id AND
  (m.bucketlist,m.rumpel,m.assignment_reason,m.bucketlist_pinned) IS DISTINCT FROM
  (d.target_bucket,d.target_rumpel,d.reason,(d.target_bucket AND d.bucket_preference='include'));
 PERFORM set_config('geza.classifying',previous,true);
END $$;

CREATE OR REPLACE FUNCTION media_rumpel_before() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF COALESCE(current_setting('geza.classifying',true),'')<>'on' AND NOT rumpel_skip() THEN
  IF TG_OP='INSERT' THEN
   IF NEW.bucketlist THEN NEW.bucket_preference:='include'; END IF;
  ELSIF NEW.bucketlist IS DISTINCT FROM OLD.bucketlist AND NEW.bucket_preference=OLD.bucket_preference THEN
   NEW.bucket_preference:=CASE WHEN NEW.bucketlist THEN 'include' ELSE 'exclude' END;
  END IF;
 END IF;
 IF NEW.bucketlist THEN NEW.rumpel:=false; ELSE NEW.bucketlist_pinned:=false; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION media_rumpel_after() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF rumpel_skip() OR COALESCE(current_setting('geza.classifying',true),'')='on' THEN RETURN NULL; END IF;
 IF TG_OP='UPDATE' AND OLD.parent_id IS NOT NULL AND OLD.parent_id IS DISTINCT FROM NEW.parent_id THEN
  PERFORM rumpel_refresh_locked(rumpel_root(OLD.parent_id));
 END IF;
 PERFORM rumpel_refresh_locked(rumpel_root(NEW.id));
 RETURN NULL;
END $$;
DROP TRIGGER media_rumpel_update ON media;
CREATE TRIGGER media_rumpel_update AFTER UPDATE OF bucketlist,parent_id,kind,season,bucket_preference,origins,seen_sources,plex_watched,plex_automatic,plex_libraries ON media
 FOR EACH ROW EXECUTE FUNCTION media_rumpel_after();
SELECT rumpel_refresh(NULL);
