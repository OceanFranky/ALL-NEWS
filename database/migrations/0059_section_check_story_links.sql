ALTER TABLE story_links ADD CONSTRAINT story_links_section_check CHECK (section_id IN ('ai', 'world')) NOT VALID;
