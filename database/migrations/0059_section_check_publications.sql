ALTER TABLE publications ADD CONSTRAINT publications_section_check CHECK (section_id IN ('ai', 'world')) NOT VALID;
