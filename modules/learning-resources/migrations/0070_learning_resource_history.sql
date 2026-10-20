CREATE TABLE IF NOT EXISTS learning_resource_history (
  resource_id uuid NOT NULL REFERENCES learning_resources(id),
  version integer NOT NULL,
  actor text NOT NULL,
  reason text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (resource_id, version)
);
