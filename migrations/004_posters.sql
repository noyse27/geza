CREATE TABLE IF NOT EXISTS posters (
 media_id bigint PRIMARY KEY REFERENCES media(id), content_type text NOT NULL, data bytea NOT NULL,
 etag text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
