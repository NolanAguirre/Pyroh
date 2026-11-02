BEGIN;

INSERT OR IGNORE INTO main.session_status (name) VALUES
  ('subagent');

COMMIT;
