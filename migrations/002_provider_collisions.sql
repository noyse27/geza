-- External catalogs occasionally assign one Plex GUID to multiple Trakt records.
-- Preserve original identities; require manual resolution on webhook matching.
DROP INDEX IF EXISTS media_plex;
CREATE INDEX IF NOT EXISTS media_plex ON media(kind,(ids->>'plex')) WHERE ids ? 'plex';
CREATE INDEX IF NOT EXISTS media_tmdb ON media(kind,(ids->>'tmdb')) WHERE ids ? 'tmdb';
CREATE INDEX IF NOT EXISTS media_tvdb ON media(kind,(ids->>'tvdb')) WHERE ids ? 'tvdb';
CREATE INDEX IF NOT EXISTS media_imdb ON media(kind,(ids->>'imdb')) WHERE ids ? 'imdb';
