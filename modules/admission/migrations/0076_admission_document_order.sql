ALTER TABLE admission_documents ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 1000;
