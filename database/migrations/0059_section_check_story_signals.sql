ALTER TABLE story_signals ADD CONSTRAINT story_signals_section_check CHECK (section_id IN ('ai', 'world')) NOT VALID;
