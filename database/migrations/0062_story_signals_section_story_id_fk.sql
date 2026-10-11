ALTER TABLE story_signals ADD CONSTRAINT story_signals_section_story_id_fk FOREIGN KEY (section_id, story_id) REFERENCES stories (section_id, id) ON DELETE CASCADE NOT VALID;
