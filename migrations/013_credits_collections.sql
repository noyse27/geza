CREATE INDEX IF NOT EXISTS media_movie_directors ON media USING gin(directors) WHERE kind='movie';
CREATE INDEX IF NOT EXISTS media_movie_actors ON media USING gin(actors) WHERE kind='movie';
