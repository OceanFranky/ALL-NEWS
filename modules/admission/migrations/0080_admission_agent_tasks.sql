CREATE TABLE IF NOT EXISTS admission_agent_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity text NOT NULL UNIQUE,
  goal jsonb NOT NULL,
  state jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz,
  next_check_at timestamptz NOT NULL DEFAULT now()
);
