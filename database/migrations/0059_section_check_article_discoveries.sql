ALTER TABLE article_discoveries ADD CONSTRAINT article_discoveries_section_check CHECK (section_id IN ('ai', 'world')) NOT VALID;
