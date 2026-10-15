ALTER TABLE fetch_runs ADD CONSTRAINT fetch_runs_section_check CHECK (section_id IN ('ai', 'world')) NOT VALID;
