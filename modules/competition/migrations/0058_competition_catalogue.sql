CREATE TABLE IF NOT EXISTS competition_catalogue (
  id text PRIMARY KEY CHECK (id ~ '^competition-[0-9]{3}$'),
  name text NOT NULL,
  recognition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
