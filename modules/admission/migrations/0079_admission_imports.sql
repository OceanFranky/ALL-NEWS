CREATE TABLE IF NOT EXISTS admission_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id text NOT NULL REFERENCES admission_sources(school_id),
  url text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('notice','listing')),
  status text NOT NULL DEFAULT 'queued',
  title text NOT NULL DEFAULT '',
  document_ids jsonb NOT NULL DEFAULT '[]',
  stats jsonb NOT NULL DEFAULT '{}',
  error text,
  enabled boolean NOT NULL DEFAULT true,
  force_retry boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz,
  next_check_at timestamptz NOT NULL DEFAULT now()
);
