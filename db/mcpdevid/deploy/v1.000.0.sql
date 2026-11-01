BEGIN;

CREATE TABLE IF NOT EXISTS dev_ids (
  id TEXT PRIMARY KEY CHECK (length(id) = 7 AND id NOT GLOB '*[^a-z0-9]*'),
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

COMMIT;
