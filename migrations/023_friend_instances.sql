-- Friends of Geza: befriended Geza instances that answer rating/review lookups.
-- Secrets are encrypted with this installation's SESSION_SECRET, so these tables are not part of a server transfer.
CREATE TABLE friend_instances (
  id bigserial PRIMARY KEY,
  url text NOT NULL UNIQUE,
  nickname text NOT NULL,
  status text NOT NULL CHECK (status IN ('outgoing','incoming','accepted')),
  nonce text,
  secret_enc text,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  CHECK (status<>'accepted' OR secret_enc IS NOT NULL)
);
CREATE TABLE friend_instance_cache (
  friend_id bigint NOT NULL REFERENCES friend_instances(id) ON DELETE CASCADE,
  media_id bigint NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  found boolean NOT NULL DEFAULT false,
  rating int CHECK (rating BETWEEN 1 AND 10),
  has_review boolean NOT NULL DEFAULT false,
  url text,
  error boolean NOT NULL DEFAULT false,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (friend_id, media_id)
);
