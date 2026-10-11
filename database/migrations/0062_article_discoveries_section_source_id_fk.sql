ALTER TABLE article_discoveries ADD CONSTRAINT article_discoveries_section_source_id_fk FOREIGN KEY (section_id, source_id) REFERENCES sources (section_id, id) NOT VALID;
