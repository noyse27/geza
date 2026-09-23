-- Rumpelkammer: Filme und Serien ohne jede Aktivität, die nicht auf der Bucketliste stehen.
-- Jeder Film und jede Serie ist in genau einem Zustand: Archiv (Aktivität), Bucketliste oder Rumpelkammer.
-- Aktivität = Sichtung, Bewertung, Review, manueller Friend-Review oder Filmreihe; bei Serien zählt der ganze Baum.
ALTER TABLE media ADD COLUMN IF NOT EXISTS rumpel boolean NOT NULL DEFAULT false;
ALTER TABLE media ADD COLUMN IF NOT EXISTS bucketlist_pinned boolean NOT NULL DEFAULT false;
ALTER TABLE media ADD CONSTRAINT media_rumpel_not_bucketlist CHECK (NOT (rumpel AND bucketlist));
CREATE INDEX IF NOT EXISTS media_rumpel ON media(kind,title,id) WHERE rumpel;

-- Gedächtnis für in der Rumpelkammer gelöschte Titel, damit spätere Importe sie nicht erneut anlegen.
CREATE TABLE IF NOT EXISTS rumpel_deleted (
 id bigserial PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN ('movie','show')),
 title text NOT NULL,
 year integer,
 ids jsonb NOT NULL DEFAULT '{}',
 deleted_at timestamptz NOT NULL DEFAULT now()
);

-- Wurzel eines Eintrags: Film/Serie selbst, bei Staffeln und Episoden die Serie.
CREATE OR REPLACE FUNCTION rumpel_root(start_id bigint) RETURNS bigint LANGUAGE sql STABLE AS $$
 WITH RECURSIVE up(id,parent_id) AS (
  SELECT id,parent_id FROM media WHERE id=start_id
  UNION ALL SELECT m.id,m.parent_id FROM media m JOIN up ON m.id=up.parent_id
 ) SELECT id FROM up WHERE parent_id IS NULL LIMIT 1
$$;

-- Berechnet die Zugehörigkeit neu. NULL = alle Bäume; sonst nur die Bäume der übergebenen Wurzeln.
CREATE OR REPLACE FUNCTION rumpel_refresh(roots bigint[]) RETURNS void LANGUAGE sql AS $$
 WITH RECURSIVE tree(id,root_id) AS (
  SELECT id,id FROM media WHERE CASE WHEN roots IS NULL THEN parent_id IS NULL ELSE id=ANY(roots) END
  UNION ALL SELECT c.id,t.root_id FROM media c JOIN tree t ON c.parent_id=t.id
 ), active AS (
  SELECT DISTINCT t.root_id FROM tree t WHERE
   EXISTS(SELECT 1 FROM watches w WHERE w.media_id=t.id)
   OR EXISTS(SELECT 1 FROM ratings r WHERE r.media_id=t.id)
   OR EXISTS(SELECT 1 FROM reviews v WHERE v.media_id=t.id)
   OR EXISTS(SELECT 1 FROM friend_reviews f WHERE f.media_id=t.id AND f.manual)
   OR EXISTS(SELECT 1 FROM film_series_members s WHERE s.media_id=t.id)
 ), want AS (
  SELECT t.id,(r.kind IN ('movie','show') AND NOT r.bucketlist AND t.root_id NOT IN (SELECT root_id FROM active)) AS rumpel
  FROM tree t JOIN media r ON r.id=t.root_id
 )
 UPDATE media m SET rumpel=w.rumpel FROM want w WHERE m.id=w.id AND m.rumpel IS DISTINCT FROM w.rumpel
$$;

-- Pro Baum serialisiert, damit gleichzeitige Änderungen an derselben Serie nicht in Zeilensperren kollidieren.
CREATE OR REPLACE FUNCTION rumpel_refresh_locked(root bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF root IS NULL THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('rumpel:'||root,0));
 PERFORM rumpel_refresh(ARRAY[root]);
END $$;

-- Massenoperationen (Import, Umzug) setzen geza.skip_rumpel und rufen rumpel_refresh(NULL) einmal am Ende auf.
CREATE OR REPLACE FUNCTION rumpel_skip() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE(current_setting('geza.skip_rumpel',true),'')='on'
$$;

-- Bucketliste und Rumpelkammer schließen sich aus; eine Rücknahme aus der Bucketliste hebt die Fixierung auf.
CREATE OR REPLACE FUNCTION media_rumpel_before() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.bucketlist THEN NEW.rumpel := false; ELSE NEW.bucketlist_pinned := false; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS media_rumpel_before ON media;
CREATE TRIGGER media_rumpel_before BEFORE INSERT OR UPDATE ON media FOR EACH ROW EXECUTE FUNCTION media_rumpel_before();

CREATE OR REPLACE FUNCTION media_rumpel_after() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF rumpel_skip() THEN RETURN NULL; END IF;
 IF TG_OP='UPDATE' AND OLD.parent_id IS NOT NULL AND OLD.parent_id IS DISTINCT FROM NEW.parent_id THEN
  PERFORM rumpel_refresh_locked(rumpel_root(OLD.parent_id));
 END IF;
 PERFORM rumpel_refresh_locked(rumpel_root(NEW.id));
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS media_rumpel_insert ON media;
CREATE TRIGGER media_rumpel_insert AFTER INSERT ON media FOR EACH ROW EXECUTE FUNCTION media_rumpel_after();
DROP TRIGGER IF EXISTS media_rumpel_update ON media;
CREATE TRIGGER media_rumpel_update AFTER UPDATE OF bucketlist,parent_id,kind ON media FOR EACH ROW EXECUTE FUNCTION media_rumpel_after();

CREATE OR REPLACE FUNCTION activity_rumpel_after() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF rumpel_skip() THEN RETURN NULL; END IF;
 IF TG_OP IN ('UPDATE','DELETE') THEN
  PERFORM rumpel_refresh_locked(rumpel_root(OLD.media_id));
 END IF;
 IF TG_OP IN ('INSERT','UPDATE') THEN
  PERFORM rumpel_refresh_locked(rumpel_root(NEW.media_id));
 END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS watches_rumpel ON watches;
CREATE TRIGGER watches_rumpel AFTER INSERT OR DELETE OR UPDATE OF media_id ON watches FOR EACH ROW EXECUTE FUNCTION activity_rumpel_after();
DROP TRIGGER IF EXISTS ratings_rumpel ON ratings;
CREATE TRIGGER ratings_rumpel AFTER INSERT OR DELETE OR UPDATE OF media_id ON ratings FOR EACH ROW EXECUTE FUNCTION activity_rumpel_after();
DROP TRIGGER IF EXISTS reviews_rumpel ON reviews;
CREATE TRIGGER reviews_rumpel AFTER INSERT OR DELETE OR UPDATE OF media_id ON reviews FOR EACH ROW EXECUTE FUNCTION activity_rumpel_after();
DROP TRIGGER IF EXISTS friend_reviews_rumpel ON friend_reviews;
CREATE TRIGGER friend_reviews_rumpel AFTER INSERT OR DELETE OR UPDATE OF media_id,manual ON friend_reviews FOR EACH ROW EXECUTE FUNCTION activity_rumpel_after();
DROP TRIGGER IF EXISTS film_series_members_rumpel ON film_series_members;
CREATE TRIGGER film_series_members_rumpel AFTER INSERT OR DELETE OR UPDATE OF media_id ON film_series_members FOR EACH ROW EXECUTE FUNCTION activity_rumpel_after();

-- Bestand einmalig einordnen.
SELECT rumpel_refresh(NULL);
