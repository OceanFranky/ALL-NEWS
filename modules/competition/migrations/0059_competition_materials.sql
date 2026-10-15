CREATE TABLE IF NOT EXISTS competition_materials (
  competition_id text NOT NULL REFERENCES competition_catalogue(id),
  id text NOT NULL,
  url text NOT NULL,
  content_hash text NOT NULL,
  fetched_at timestamptz NOT NULL,
  content jsonb NOT NULL,
  PRIMARY KEY (competition_id, id),
  UNIQUE (competition_id, url, content_hash)
);
