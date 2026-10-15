ALTER TABLE fact_articles ADD CONSTRAINT fact_articles_section_fact_id_fk FOREIGN KEY (section_id, fact_id) REFERENCES facts (section_id, id) ON DELETE CASCADE NOT VALID;
