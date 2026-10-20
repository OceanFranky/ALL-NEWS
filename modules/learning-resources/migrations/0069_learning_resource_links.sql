CREATE TABLE IF NOT EXISTS learning_resource_links (
  resource_id uuid NOT NULL REFERENCES learning_resources(id),
  position integer NOT NULL CHECK (position >= 0),
  competition_id text NOT NULL REFERENCES competition_catalogue(id),
  edition_id uuid,
  year integer CHECK (year BETWEEN 1900 AND 2200),
  scope text NOT NULL,
  reason text NOT NULL,
  PRIMARY KEY (resource_id, position),
  FOREIGN KEY (competition_id, edition_id) REFERENCES competition_editions(competition_id, id)
);
