CREATE TABLE section_budgets (
  section_id text NOT NULL CHECK (section_id IN ('ai', 'world')),
  service text NOT NULL,
  per_minute integer NOT NULL CHECK (per_minute >= 0),
  per_hour integer NOT NULL CHECK (per_hour >= 0),
  per_day integer NOT NULL CHECK (per_day >= 0),
  PRIMARY KEY (section_id, service)
);
