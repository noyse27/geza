CREATE TABLE review_commenters (
  id bigserial PRIMARY KEY,
  email_hash text NOT NULL UNIQUE,
  email_encrypted text NOT NULL,
  name text NOT NULL,
  website text,
  approved_count integer NOT NULL DEFAULT 0 CHECK(approved_count >= 0),
  blocked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE review_comments (
  id bigserial PRIMARY KEY,
  review_id bigint NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  commenter_id bigint NOT NULL REFERENCES review_commenters(id) ON DELETE CASCADE,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','spam','rejected')),
  browser_hash text NOT NULL,
  network_hash text NOT NULL,
  moderation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX review_comments_review_published ON review_comments(review_id,created_at) WHERE status='published';
CREATE INDEX review_comments_moderation ON review_comments(status,created_at DESC);
CREATE INDEX review_comments_commenter ON review_comments(commenter_id,created_at DESC);
CREATE INDEX review_comments_browser_recent ON review_comments(browser_hash,created_at DESC);
CREATE INDEX review_comments_network_recent ON review_comments(network_hash,created_at DESC);

CREATE TABLE review_reactions (
  review_id bigint NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  browser_hash text NOT NULL,
  reaction text NOT NULL CHECK(reaction IN ('like','dislike','love','laugh','applause','confused')),
  network_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(review_id,browser_hash)
);
CREATE INDEX review_reactions_review ON review_reactions(review_id,reaction);
CREATE INDEX review_reactions_network_recent ON review_reactions(network_hash,updated_at DESC);
