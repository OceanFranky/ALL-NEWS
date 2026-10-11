ALTER TABLE publications ADD CONSTRAINT publications_section_analysis_fk FOREIGN KEY (section_id, analysis_id, article_id) REFERENCES analyses (section_id, id, article_id) NOT VALID;
