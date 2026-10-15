CREATE TABLE IF NOT EXISTS competition_sources (
  competition_id text NOT NULL REFERENCES competition_catalogue(id),
  url text NOT NULL,
  status text NOT NULL CHECK (status IN ('candidate', 'confirmed', 'unresolved')),
  evidence jsonb NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (competition_id, url)
);
