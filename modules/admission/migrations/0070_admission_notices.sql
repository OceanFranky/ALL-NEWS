CREATE TABLE IF NOT EXISTS admission_notices (
  id uuid PRIMARY KEY,
  identity_key text NOT NULL UNIQUE,
  draft jsonb NOT NULL,
  published jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  published_version integer,
  published_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
