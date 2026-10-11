ALTER TABLE fact_articles ADD CONSTRAINT fact_articles_section_check CHECK (section_id IN ('ai', 'world')) NOT VALID;
