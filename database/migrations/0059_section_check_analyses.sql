ALTER TABLE analyses ADD CONSTRAINT analyses_section_check CHECK (section_id IN ('ai', 'world')) NOT VALID;
