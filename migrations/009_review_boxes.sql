CREATE TABLE review_boxes (
 provider text PRIMARY KEY,
 name text NOT NULL,
 scale numeric NOT NULL DEFAULT 5 CHECK(scale BETWEEN 1 AND 100)
);
-- Before this migration, filmdienst and wortvogel were hardcoded and always active,
-- so upgrading installs keep both boxes configured to preserve existing friend_reviews.
-- Removing a box afterwards is a deliberate admin action from here on.
INSERT INTO review_boxes(provider,name,scale) VALUES
 ('filmdienst','Filmdienst.de',5),
 ('wortvogel','wortvogel.de',5);
