CREATE TABLE IF NOT EXISTS admission_changes (
  id bigserial PRIMARY KEY,
  notice_id uuid NOT NULL REFERENCES admission_notices(id),
  version integer NOT NULL,
  kind text NOT NULL,
  fields jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(notice_id, version)
);
