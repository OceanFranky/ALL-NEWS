ALTER TABLE selected_ledger ADD CONSTRAINT selected_ledger_section_check CHECK (section_id IN ('ai', 'world')) NOT VALID;
