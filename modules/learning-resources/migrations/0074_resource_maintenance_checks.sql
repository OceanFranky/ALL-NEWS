CREATE TABLE IF NOT EXISTS resource_maintenance_checks (
  key text PRIMARY KEY,
  checked_at timestamptz NOT NULL DEFAULT now(),
  observation jsonb NOT NULL
);
