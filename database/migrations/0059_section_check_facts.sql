ALTER TABLE facts ADD CONSTRAINT facts_section_check CHECK (section_id IN ('ai', 'world')) NOT VALID;
