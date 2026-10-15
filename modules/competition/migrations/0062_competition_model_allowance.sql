CREATE TABLE IF NOT EXISTS competition_model_allowance (
  request_key text PRIMARY KEY,
  batch text NOT NULL,
  reserved_cny numeric NOT NULL CHECK (reserved_cny > 0),
  actual_upper_cny numeric,
  receipt_id bigint REFERENCES receipts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
