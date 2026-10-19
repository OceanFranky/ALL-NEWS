CREATE TABLE IF NOT EXISTS admission_agent_steps (
  id bigserial PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES admission_agent_tasks(id),
  cycle integer NOT NULL,
  stage text NOT NULL,
  status text NOT NULL,
  url text,
  title text NOT NULL,
  detail text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
