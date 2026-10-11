ALTER TABLE selected_state ADD CONSTRAINT selected_state_section_check CHECK (section_id IN ('ai', 'world')) NOT VALID;
