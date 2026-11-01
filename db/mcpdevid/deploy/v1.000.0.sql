BEGIN;

CREATE TABLE IF NOT EXISTS dev_ids (
  id TEXT PRIMARY KEY CHECK (length(id) = 7 AND id NOT GLOB '*[^a-z0-9]*'),
  source TEXT NOT NULL,
  workspace_id TEXT,
  session_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS dev_ids_workspace_id ON dev_ids (workspace_id);

COMMIT;
