CREATE TABLE IF NOT EXISTS admission_sources (
  school_id text PRIMARY KEY,
  config jsonb NOT NULL,
  last_checked_at timestamptz,
  last_ok_at timestamptz,
  next_check_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  detail jsonb NOT NULL DEFAULT '{}'
);
