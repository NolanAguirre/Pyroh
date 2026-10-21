BEGIN;

-- Registry of harness workspaces and sessions, mirrored from HARNESS_WRITE_DIR.
CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text,
  path text,
  meta jsonb,
  synced_at timestamptz
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  workspace_id text REFERENCES workspaces (id),
  name text,
  provider text,
  model text,
  cwd text,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz,
  updated_at timestamptz,
  session_dir text NOT NULL,
  events_path text,
  -- Absolute paths: runs/*.cursor.jsonl, sdk-store/**, phase step files.
  transcript_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Size + mtime of events.jsonl, usage/, runs/, phase-* (see lib/source/harness.js).
  source_fingerprint jsonb,
  -- Raw session.json.
  meta jsonb,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz
);

CREATE INDEX IF NOT EXISTS sessions_workspace_id_idx ON sessions (workspace_id);
CREATE INDEX IF NOT EXISTS sessions_provider_idx ON sessions (provider);
CREATE INDEX IF NOT EXISTS sessions_updated_at_idx ON sessions (updated_at);

-- One cached result per session/metric pair. Stale when the version is behind
-- the registered metric, the fingerprint differs from sessions, or it errored.
CREATE TABLE IF NOT EXISTS metric_results (
  session_id text NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  metric text NOT NULL,
  version int NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('pending', 'running', 'ok', 'error')),
  result jsonb,
  error text,
  source_fingerprint jsonb,
  computed_at timestamptz,
  duration_ms int,
  PRIMARY KEY (session_id, metric)
);

-- Fact tables rewritten per session by metrics.
CREATE TABLE IF NOT EXISTS runs (
  session_id text NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  run_id text NOT NULL,
  started_at timestamptz,
  step text,
  duration_ms bigint,
  input bigint,
  output bigint,
  cache_read bigint,
  cache_write bigint,
  reasoning bigint,
  total bigint,
  PRIMARY KEY (session_id, run_id)
);

CREATE INDEX IF NOT EXISTS runs_started_at_idx ON runs (started_at);

CREATE TABLE IF NOT EXISTS tool_calls (
  session_id text NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  call_key text NOT NULL,
  run_id text,
  ts timestamptz,
  name text,
  subagent_type text,
  phase text,
  step text,
  target_kind text,
  target text,
  signature text,
  PRIMARY KEY (session_id, call_key)
);

CREATE INDEX IF NOT EXISTS tool_calls_ts_idx ON tool_calls (ts);
CREATE INDEX IF NOT EXISTS tool_calls_name_idx ON tool_calls (name);
CREATE INDEX IF NOT EXISTS tool_calls_session_run_idx ON tool_calls (session_id, run_id);

-- done counts finished tasks, including failed ones.
CREATE TABLE IF NOT EXISTS jobs (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  params jsonb,
  status text NOT NULL,
  total int NOT NULL DEFAULT 0,
  done int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS jobs_created_at_idx ON jobs (created_at);

COMMIT;
