CREATE TABLE IF NOT EXISTS admission_documents (
  id text PRIMARY KEY,
  school_id text NOT NULL REFERENCES admission_sources(school_id),
  url text NOT NULL,
  title text NOT NULL,
  published_on text,
  last_checked_at timestamptz,
  last_ok_at timestamptz,
  content_hash text,
  processed_hash text,
  status text NOT NULL DEFAULT 'new',
  error text,
  result jsonb,
  notice_ids jsonb NOT NULL DEFAULT '[]',
  UNIQUE(school_id, url)
);
