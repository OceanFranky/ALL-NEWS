ALTER TABLE stories ADD CONSTRAINT stories_section_merged_into_fk FOREIGN KEY (section_id, merged_into) REFERENCES stories (section_id, id) NOT VALID;
