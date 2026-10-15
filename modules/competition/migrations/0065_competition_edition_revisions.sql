CREATE TABLE IF NOT EXISTS competition_edition_revisions (
  competition_id text NOT NULL,
  edition_id uuid NOT NULL,
  revision_id text NOT NULL,
  PRIMARY KEY (competition_id, edition_id, revision_id),
  UNIQUE (competition_id, revision_id),
  FOREIGN KEY (competition_id, edition_id) REFERENCES competition_editions(competition_id, id),
  FOREIGN KEY (competition_id, revision_id) REFERENCES competition_revisions(competition_id, id)
);
