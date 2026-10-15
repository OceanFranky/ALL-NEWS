CREATE TABLE IF NOT EXISTS competition_revisions (
  competition_id text NOT NULL REFERENCES competition_catalogue(id),
  id text NOT NULL,
  run_id text NOT NULL REFERENCES competition_runs(id),
  year integer,
  name text,
  status text NOT NULL CHECK (status IN ('draft', 'needs_review', 'approved', 'rejected')),
  data jsonb NOT NULL,
  validation jsonb NOT NULL,
  material_ids jsonb NOT NULL,
  receipt_id bigint REFERENCES receipts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (competition_id, id)
);
