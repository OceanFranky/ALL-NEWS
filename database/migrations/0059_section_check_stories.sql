ALTER TABLE stories ADD CONSTRAINT stories_section_check CHECK (section_id IN ('ai', 'world')) NOT VALID;
