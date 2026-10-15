ALTER TABLE publications ADD CONSTRAINT publications_section_fact_id_fk FOREIGN KEY (section_id, fact_id) REFERENCES facts (section_id, id) NOT VALID;
