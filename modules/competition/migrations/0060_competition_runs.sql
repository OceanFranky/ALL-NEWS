CREATE TABLE IF NOT EXISTS competition_runs (
  id text PRIMARY KEY,
  competition_id text NOT NULL REFERENCES competition_catalogue(id),
  status text NOT NULL CHECK (status IN ('running', 'completed', 'needs_review', 'failed', 'budget_stopped')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  report jsonb NOT NULL DEFAULT '{}'
);
