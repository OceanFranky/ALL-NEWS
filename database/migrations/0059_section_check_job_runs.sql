ALTER TABLE job_runs ADD CONSTRAINT job_runs_section_check CHECK (section_id IN ('ai', 'world')) NOT VALID;
