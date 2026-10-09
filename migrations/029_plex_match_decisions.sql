CREATE TABLE plex_match_decisions (
 server_id text NOT NULL,
 rating_key text NOT NULL,
 guid text NOT NULL,
 media_id bigint NOT NULL REFERENCES media(id) ON DELETE CASCADE,
 provider_ids jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(server_id,rating_key,guid)
);
CREATE INDEX plex_match_decisions_media ON plex_match_decisions(media_id);
