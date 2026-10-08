ALTER TABLE jobs ADD COLUMN queued_at timestamptz;
ALTER TABLE jobs ADD COLUMN active_run_id bigint;
CREATE TABLE job_runs (
 id bigserial PRIMARY KEY, job_id bigint NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 kind text NOT NULL, attempt integer NOT NULL, status text NOT NULL DEFAULT 'running',
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 heartbeat_at timestamptz NOT NULL DEFAULT now(), progress_at timestamptz,
 phase text, completed integer, total integer, error text
);
CREATE INDEX job_runs_recent ON job_runs(id DESC);
CREATE INDEX job_runs_job ON job_runs(job_id,id DESC);
CREATE TABLE job_results (
 id bigserial PRIMARY KEY, run_id bigint NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE,
 media_id bigint REFERENCES media(id) ON DELETE SET NULL,
 title text NOT NULL, outcome text NOT NULL, destination text, reason text,
 details jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX job_results_run ON job_results(run_id,id);
CREATE FUNCTION track_job_queue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN NEW.queued_at=now();
 ELSIF NEW.status='pending' AND (OLD.status<>'pending' OR NEW.available_at IS DISTINCT FROM OLD.available_at) THEN
  NEW.queued_at=now();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER track_job_queue BEFORE INSERT OR UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION track_job_queue();
