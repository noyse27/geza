CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE IF NOT EXISTS media (
 id bigserial PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('movie','show','season','episode')),
 trakt_id bigint, title text NOT NULL, original_title text NOT NULL DEFAULT '', year integer,
 parent_id bigint REFERENCES media(id), season integer, episode integer,
 ids jsonb NOT NULL DEFAULT '{}', summary text NOT NULL DEFAULT '', countries text[] NOT NULL DEFAULT '{}',
 genres text[] NOT NULL DEFAULT '{}', directors text[] NOT NULL DEFAULT '{}', actors text[] NOT NULL DEFAULT '{}',
 certification text, runtime integer, poster text, locked_fields text[] NOT NULL DEFAULT '{}',
 search_text text NOT NULL DEFAULT '', search_vector tsvector,
 enriched_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(kind,trakt_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS media_plex ON media(kind,(ids->>'plex')) WHERE ids ? 'plex';
CREATE INDEX IF NOT EXISTS media_parent ON media(parent_id);
CREATE INDEX IF NOT EXISTS media_search_trgm ON media USING gin(search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS media_search_fts ON media USING gin(search_vector);
CREATE INDEX IF NOT EXISTS media_title_prefix ON media(lower(title) text_pattern_ops);
CREATE INDEX IF NOT EXISTS media_kind_year ON media(kind,year,id);
CREATE OR REPLACE FUNCTION media_search_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.search_text := lower(NEW.title || ' ' || NEW.original_title || ' ' || COALESCE(NEW.ids->>'imdb','') || ' ' || COALESCE(NEW.ids->>'tmdb','') || ' ' || COALESCE(NEW.ids->>'tvdb','') || ' ' || array_to_string(NEW.directors,' ') || ' ' || array_to_string(NEW.actors,' '));
 NEW.search_vector := setweight(to_tsvector('simple', NEW.title || ' ' || NEW.original_title),'A') || setweight(to_tsvector('simple', array_to_string(NEW.directors,' ') || ' ' || array_to_string(NEW.actors,' ')),'B') || setweight(to_tsvector('simple',NEW.summary),'C');
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS media_search_trigger ON media;
CREATE TRIGGER media_search_trigger BEFORE INSERT OR UPDATE ON media FOR EACH ROW EXECUTE FUNCTION media_search_update();
CREATE TABLE IF NOT EXISTS watches (
 id bigserial PRIMARY KEY, media_id bigint NOT NULL REFERENCES media(id), source text NOT NULL,
 source_id text NOT NULL, watched_at timestamptz, original_watched_at text,
 time_estimated boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(source,source_id)
);
CREATE INDEX IF NOT EXISTS watches_timeline ON watches(watched_at DESC,id DESC) WHERE watched_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS watches_media ON watches(media_id,watched_at DESC);
CREATE TABLE IF NOT EXISTS ratings (
 media_id bigint PRIMARY KEY REFERENCES media(id), rating integer NOT NULL CHECK(rating BETWEEN 1 AND 10),
 rated_at timestamptz NOT NULL, source text NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
 id bigserial PRIMARY KEY, media_id bigint NOT NULL REFERENCES media(id), source text NOT NULL,
 source_id text NOT NULL, body text NOT NULL, spoiler boolean NOT NULL DEFAULT false,
 is_public boolean NOT NULL DEFAULT false, parent_source_id text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(source,source_id)
);
CREATE INDEX IF NOT EXISTS reviews_media ON reviews(media_id);
CREATE INDEX IF NOT EXISTS reviews_public_text ON reviews USING gin(to_tsvector('simple',body)) WHERE is_public;
CREATE TABLE IF NOT EXISTS admin_account (id integer PRIMARY KEY CHECK(id=1), username text NOT NULL, password_hash text NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS login_attempts (key text PRIMARY KEY, attempts integer NOT NULL DEFAULT 0, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (
 id bigserial PRIMARY KEY, kind text NOT NULL, dedupe_key text UNIQUE, payload jsonb NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), error text
);
CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(available_at,id) WHERE status='pending';
CREATE TABLE IF NOT EXISTS import_runs (id bigserial PRIMARY KEY, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, report jsonb);
