ALTER TABLE selectbench_runs ADD CONSTRAINT selectbench_runs_section_check CHECK (section_id IN ('ai', 'world')) NOT VALID;
