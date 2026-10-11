ALTER TABLE fetch_runs ADD CONSTRAINT fetch_runs_section_source_fk FOREIGN KEY (section_id, source_id) REFERENCES sources (section_id, id) NOT VALID;
