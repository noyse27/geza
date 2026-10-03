ALTER TABLE media ADD COLUMN original_countries text[];
ALTER TABLE media ADD COLUMN original_genres text[];
ALTER TABLE media ADD COLUMN facet_recovery_note text;
UPDATE media SET original_countries='{}' WHERE cardinality(countries)=0;
UPDATE media SET original_genres='{}' WHERE cardinality(genres)=0;

-- Capture future direct inserts/edits too. Projection updates explicitly opt out.
CREATE FUNCTION media_facet_originals() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF current_setting('geza.facet_projection',true) IS DISTINCT FROM 'on' THEN
     NEW.original_countries := COALESCE(NEW.original_countries,NEW.countries);
     NEW.original_genres := COALESCE(NEW.original_genres,NEW.genres);
   END IF;
 ELSIF current_setting('geza.facet_projection',true) IS DISTINCT FROM 'on' THEN
   IF NEW.countries IS DISTINCT FROM OLD.countries AND NEW.original_countries IS NOT DISTINCT FROM OLD.original_countries THEN
     NEW.original_countries := NEW.countries;
   END IF;
   IF NEW.genres IS DISTINCT FROM OLD.genres AND NEW.original_genres IS NOT DISTINCT FROM OLD.original_genres THEN
     NEW.original_genres := NEW.genres;
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER media_facet_originals_trigger BEFORE INSERT OR UPDATE OF countries,genres ON media
 FOR EACH ROW EXECUTE FUNCTION media_facet_originals();

INSERT INTO jobs(kind,dedupe_key,payload)
 SELECT 'facet-recovery','facet-recovery-v1',jsonb_build_object(
   'cursor','0','upperBound',max(id)::text,'total',count(*),'checked',0,'phase','sources')
 FROM media WHERE original_countries IS NULL OR original_genres IS NULL
 HAVING count(*)>0
 ON CONFLICT(dedupe_key) DO NOTHING;
