CREATE TABLE IF NOT EXISTS resource_maintenance_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  version integer NOT NULL DEFAULT 1,
  config jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
