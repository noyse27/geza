CREATE TABLE event_logs (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  level text NOT NULL,
  source text NOT NULL,
  message text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX event_logs_created ON event_logs(created_at DESC, id DESC);
