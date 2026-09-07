CREATE TABLE review_boxes (
 provider text PRIMARY KEY,
 name text NOT NULL,
 scale numeric NOT NULL DEFAULT 5 CHECK(scale BETWEEN 1 AND 100)
);
-- Intentionally empty: installing a module does not configure a box.
-- Existing per-title links are retained, but only configured providers are displayed.
