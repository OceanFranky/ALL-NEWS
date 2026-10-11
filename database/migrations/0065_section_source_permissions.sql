CREATE TABLE section_source_permissions (
  section_id text NOT NULL CHECK (section_id IN ('ai', 'world')),
  source_id text NOT NULL,
  summary_allowed boolean NOT NULL DEFAULT false,
  permission_reference text NOT NULL CHECK (length(trim(permission_reference)) > 0),
  reviewed_by text NOT NULL CHECK (length(trim(reviewed_by)) > 0),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (section_id, source_id),
  FOREIGN KEY (section_id, source_id) REFERENCES sources (section_id, id)
);
