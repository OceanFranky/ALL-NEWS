ALTER TABLE sources ADD CONSTRAINT sources_section_check CHECK (section_id IN ('ai', 'world')) NOT VALID;
