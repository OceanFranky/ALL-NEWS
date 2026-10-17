CREATE TABLE IF NOT EXISTS admission_allowance (
  request_key uuid PRIMARY KEY,
  batch text NOT NULL,
  reserved_cny numeric NOT NULL CHECK(reserved_cny > 0),
  actual_cny numeric CHECK(actual_cny >= 0),
  receipt_id bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
