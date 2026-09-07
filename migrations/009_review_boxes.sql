CREATE TABLE review_boxes (
 provider text PRIMARY KEY,
 name text NOT NULL,
 scale numeric NOT NULL DEFAULT 5 CHECK(scale BETWEEN 1 AND 100)
);
-- Fresh installations have no reviews and start without configured boxes.
-- Preserve both formerly hardcoded boxes when upgrading existing review data.
-- This migration runs only once; later updates never reset the configuration.
INSERT INTO review_boxes(provider,name,scale)
SELECT provider,name,5 FROM (VALUES
 ('filmdienst','Filmdienst.de'),
 ('wortvogel','wortvogel.de')
) AS defaults(provider,name)
WHERE EXISTS (SELECT 1 FROM friend_reviews);

-- Preserve manually created providers as well, without changing their reviews.
INSERT INTO review_boxes(provider,name,scale)
SELECT provider,COALESCE(MAX(NULLIF(name,'')),provider),MAX(scale)
FROM friend_reviews
WHERE provider NOT IN ('filmdienst','wortvogel')
GROUP BY provider;
