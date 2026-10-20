CREATE TABLE IF NOT EXISTS learning_resources (
  id uuid PRIMARY KEY,
  url text NOT NULL UNIQUE,
  data jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'withdrawn')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
