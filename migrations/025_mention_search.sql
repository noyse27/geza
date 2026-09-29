CREATE INDEX IF NOT EXISTS media_movie_mention_title ON media USING gin(lower(title) gin_trgm_ops) WHERE kind='movie' AND NOT rumpel;
CREATE INDEX IF NOT EXISTS media_movie_mention_original_title ON media USING gin(lower(original_title) gin_trgm_ops) WHERE kind='movie' AND NOT rumpel;
