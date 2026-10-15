ALTER TABLE articles ADD CONSTRAINT articles_section_check CHECK (section_id IN ('ai', 'world')) NOT VALID;
