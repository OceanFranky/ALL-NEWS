CREATE TABLE IF NOT EXISTS admission_snapshots (
  document_id text NOT NULL REFERENCES admission_documents(id),
  hash text NOT NULL,
  material jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(document_id, hash)
);
