CREATE INDEX CONCURRENTLY IF NOT EXISTS fetch_runs_section_source_idx ON fetch_runs (section_id, source_id, started_at DESC);
