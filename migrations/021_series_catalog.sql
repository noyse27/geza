ALTER TABLE media ADD COLUMN air_date date;
ALTER TABLE media ADD COLUMN catalog_checked_at timestamptz;
ALTER TABLE media ADD COLUMN catalog_backfill_before timestamptz;
-- The worker performs network work after deployment, never inside the migration.
UPDATE media SET catalog_backfill_before=now() WHERE kind='show' AND NOT rumpel;
