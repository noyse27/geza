CREATE TABLE media_view_totals (
  media_id bigint PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  views bigint NOT NULL DEFAULT 0 CHECK(views >= 0),
  last_viewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE media_view_dedup (
  media_id bigint NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  viewed_on date NOT NULL,
  visitor_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(media_id,viewed_on,visitor_hash)
);
CREATE INDEX media_view_dedup_expiry ON media_view_dedup(created_at);
