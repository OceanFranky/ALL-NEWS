CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS analyses_section_id_article_idx ON analyses (section_id, id, article_id);
