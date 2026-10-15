ALTER TABLE story_signals ADD CONSTRAINT story_signals_section_source_id_fk FOREIGN KEY (section_id, source_id) REFERENCES sources (section_id, id) NOT VALID;
