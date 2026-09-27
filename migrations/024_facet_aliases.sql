CREATE TABLE facet_aliases (
 category text NOT NULL CHECK(category IN ('country','genre')),
 alias text NOT NULL,
 canonical text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(category,alias)
);
