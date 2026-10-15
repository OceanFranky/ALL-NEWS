ALTER TABLE publications ADD CONSTRAINT publications_section_story_id_fk FOREIGN KEY (section_id, story_id) REFERENCES stories (section_id, id) NOT VALID;
