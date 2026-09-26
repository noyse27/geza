-- Public RSS feed. Entries are written explicitly for live changes (admin UI, Plex webhook),
-- never for imports. A change waits until publish_at, so quick re-ratings collapse into one entry.
CREATE TABLE feed_entries (
  id bigserial PRIMARY KEY,
  media_id bigint NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  rating int CHECK (rating BETWEEN 1 AND 10),
  previous_rating int CHECK (previous_rating BETWEEN 1 AND 10),
  review_body text,
  spoiler boolean NOT NULL DEFAULT false,
  rating_changed boolean NOT NULL DEFAULT false,
  review_changed boolean NOT NULL DEFAULT false,
  is_update boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  publish_at timestamptz NOT NULL
);
CREATE INDEX feed_entries_publish ON feed_entries(publish_at DESC, id DESC);
CREATE INDEX feed_entries_media ON feed_entries(media_id, publish_at DESC);
