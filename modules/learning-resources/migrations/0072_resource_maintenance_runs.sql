CREATE TABLE IF NOT EXISTS resource_maintenance_runs (
  id uuid PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('queued','running','succeeded','cancelled','failed')),
  actor text NOT NULL,
  plan jsonb NOT NULL,
  report jsonb NOT NULL,
  cancel_requested boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
