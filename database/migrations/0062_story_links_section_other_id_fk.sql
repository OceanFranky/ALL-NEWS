ALTER TABLE story_links ADD CONSTRAINT story_links_section_other_id_fk FOREIGN KEY (section_id, other_id) REFERENCES stories (section_id, id) ON DELETE CASCADE NOT VALID;
