BEGIN;

CREATE TABLE IF NOT EXISTS main.session_status (
  name TEXT COLLATE NOCASE PRIMARY KEY
);

INSERT OR IGNORE INTO main.session_status (name) VALUES
  ('idle'),
  ('running'),
  ('awaiting_input'),
  ('paused'),
  ('stopped'),
  ('finished'),
  ('error'),
  ('disconnected');

CREATE TABLE IF NOT EXISTS main.provider (
  name TEXT COLLATE NOCASE PRIMARY KEY
);

INSERT OR IGNORE INTO main.provider (name) VALUES
  ('cursor'),
  ('codex'),
  ('grok'),
  ('claude');

-- Mirror of session.json files; the files stay authoritative.
-- SQLite foreign keys cannot be schema-qualified.
CREATE TABLE IF NOT EXISTS main.session (
  id TEXT PRIMARY KEY,
  status TEXT COLLATE NOCASE REFERENCES session_status (name),
  provider TEXT COLLATE NOCASE REFERENCES provider (name),
  session_id TEXT COLLATE NOCASE NOT NULL UNIQUE,
  workspace_id TEXT COLLATE NOCASE,
  name TEXT COLLATE NOCASE,
  model TEXT COLLATE NOCASE,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  source_mtime_ms REAL NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS main.session_workspace_archived_created_idx ON session (workspace_id, archived, created_at);
CREATE INDEX IF NOT EXISTS main.session_status_idx ON session (status);
CREATE INDEX IF NOT EXISTS main.session_updated_at_idx ON session (updated_at);

COMMIT;
