CREATE TABLE friend_reviews (
 media_id bigint NOT NULL REFERENCES media(id) ON DELETE CASCADE,
 provider text NOT NULL,
 name text,
 url text,
 rating numeric,
 scale numeric NOT NULL DEFAULT 5 CHECK(scale BETWEEN 1 AND 100),
 CHECK(rating IS NULL OR rating BETWEEN 0 AND scale),
 manual boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','found','missing','error','manual')),
 checked_at timestamptz,
 next_check_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(media_id,provider)
);
CREATE INDEX friend_reviews_pending ON friend_reviews(next_check_at) WHERE provider='filmdienst' AND NOT manual AND status<>'found';
CREATE TABLE provider_ratings (
 media_id bigint NOT NULL REFERENCES media(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK(provider IN ('imdb','tmdb','tvdb')),
 rating numeric NOT NULL CHECK(rating BETWEEN 0 AND 10),
 votes bigint,
 url text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(media_id,provider)
);
