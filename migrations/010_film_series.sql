CREATE TABLE IF NOT EXISTS film_series (
 id bigserial PRIMARY KEY, title text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS film_series_members (
 series_id bigint NOT NULL REFERENCES film_series(id) ON DELETE CASCADE,
 media_id bigint NOT NULL REFERENCES media(id) ON DELETE CASCADE,
 position integer NOT NULL,
 PRIMARY KEY (series_id,media_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS film_series_members_media ON film_series_members(media_id);
CREATE INDEX IF NOT EXISTS film_series_members_order ON film_series_members(series_id,position);
