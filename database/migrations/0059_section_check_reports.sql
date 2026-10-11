ALTER TABLE reports ADD CONSTRAINT reports_section_check CHECK (section_id IN ('ai', 'world')) NOT VALID;
