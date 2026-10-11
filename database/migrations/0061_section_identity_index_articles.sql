CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS articles_section_identity_idx ON articles (section_id, identity_key);
