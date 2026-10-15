ALTER TABLE receipts ADD CONSTRAINT receipts_section_check CHECK (section_id IN ('ai', 'world')) NOT VALID;
