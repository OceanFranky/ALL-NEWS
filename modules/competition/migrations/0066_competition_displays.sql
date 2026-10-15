CREATE TABLE IF NOT EXISTS competition_displays (
  competition_id text NOT NULL,
  edition_id uuid NOT NULL,
  revision_id text,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  published_at timestamptz,
  PRIMARY KEY (competition_id, edition_id),
  FOREIGN KEY (competition_id, edition_id) REFERENCES competition_editions(competition_id, id),
  FOREIGN KEY (competition_id, edition_id, revision_id) REFERENCES competition_edition_revisions(competition_id, edition_id, revision_id),
  CHECK ((revision_id IS NULL) = (published_at IS NULL))
);
