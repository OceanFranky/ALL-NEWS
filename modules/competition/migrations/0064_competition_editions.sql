CREATE TABLE IF NOT EXISTS competition_editions (
  competition_id text NOT NULL REFERENCES competition_catalogue(id),
  id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (competition_id, id)
);
