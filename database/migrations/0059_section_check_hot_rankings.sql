ALTER TABLE hot_rankings ADD CONSTRAINT hot_rankings_section_check CHECK (section_id IN ('ai', 'world')) NOT VALID;
