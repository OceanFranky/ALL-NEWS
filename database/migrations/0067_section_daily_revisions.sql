CREATE TABLE section_daily_revisions (
  id bigserial PRIMARY KEY,
  section_id text NOT NULL CHECK (section_id IN ('ai', 'world')),
  edition_date text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'withdrawn')),
  content jsonb NOT NULL,
  generated_by text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  UNIQUE (section_id, edition_date, revision)
);
