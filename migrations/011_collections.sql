CREATE INDEX IF NOT EXISTS media_movie_genres ON media USING gin(genres) WHERE kind='movie';
CREATE INDEX IF NOT EXISTS media_movie_countries ON media USING gin(countries) WHERE kind='movie';
CREATE INDEX IF NOT EXISTS media_movie_certification_title ON media(certification,title,id) WHERE kind='movie';
CREATE INDEX IF NOT EXISTS media_movie_title ON media(title,id) WHERE kind='movie';
CREATE INDEX IF NOT EXISTS ratings_rating_media ON ratings(rating,media_id);
