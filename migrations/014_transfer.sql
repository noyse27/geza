CREATE TABLE setup_restore (
 id integer PRIMARY KEY CHECK (id=1),
 owner_hash text NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE review_boxes ADD COLUMN automatic_enabled boolean NOT NULL DEFAULT true;
