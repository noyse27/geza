CREATE TABLE facet_terms (
 category text NOT NULL CHECK(category IN ('country','genre')),
 value text NOT NULL,
 is_target boolean NOT NULL DEFAULT false,
 PRIMARY KEY(category,value)
);
INSERT INTO facet_terms(category,value,is_target)
 SELECT DISTINCT category,canonical,true FROM facet_aliases;
INSERT INTO facet_terms(category,value)
 SELECT category,alias FROM facet_aliases ON CONFLICT DO NOTHING;
