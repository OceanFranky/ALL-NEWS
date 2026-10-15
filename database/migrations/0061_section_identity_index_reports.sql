CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS reports_section_kind_key_idx ON reports (section_id, kind, key);
