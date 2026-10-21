const db = require('./db')
const config = require('./config')
const harness = require('./source/harness')
const metrics = require('./metrics')

const ms = (value) => (Number.isFinite(value) ? value : null)

const upsertWorkspace = (client, workspace) => client.query(
  `INSERT INTO workspaces (id, name, path, meta, synced_at)
   VALUES ($1, $2, $3, $4::jsonb, now())
   ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, path = EXCLUDED.path, meta = EXCLUDED.meta, synced_at = now()`,
  [workspace.id, workspace.name, workspace.path, JSON.stringify(workspace.meta)],
)

// Sessions may reference a workspace whose dir is gone; keep the FK satisfied.
const ensureWorkspace = (client, id) => client.query(
  'INSERT INTO workspaces (id) VALUES ($1) ON CONFLICT (id) DO NOTHING',
  [id],
)

const upsertSession = (client, session) => client.query(
  `INSERT INTO sessions (id, workspace_id, name, provider, model, cwd, archived, created_at, updated_at,
                         session_dir, events_path, transcript_paths, source_fingerprint, meta, synced_at)
   VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8::float8 / 1000), to_timestamp($9::float8 / 1000),
           $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, now())
   ON CONFLICT (id) DO UPDATE SET
     workspace_id = EXCLUDED.workspace_id, name = EXCLUDED.name, provider = EXCLUDED.provider,
     model = EXCLUDED.model, cwd = EXCLUDED.cwd, archived = EXCLUDED.archived,
     created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at,
     session_dir = EXCLUDED.session_dir, events_path = EXCLUDED.events_path,
     transcript_paths = EXCLUDED.transcript_paths, source_fingerprint = EXCLUDED.source_fingerprint,
     meta = EXCLUDED.meta, synced_at = now()`,
  [
    session.id,
    session.workspaceId,
    session.name,
    session.provider,
    session.model,
    session.cwd,
    session.archived,
    ms(session.createdAt),
    ms(session.updatedAt),
    session.sessionDir,
    session.eventsPath,
    JSON.stringify(session.transcriptPaths),
    JSON.stringify(session.fingerprint),
    JSON.stringify(session.meta),
  ],
)

const writeSessions = async (client, sessions, knownWorkspaces) => {
  for (const session of sessions) {
    if (session.workspaceId && !knownWorkspaces.has(session.workspaceId)) {
      await ensureWorkspace(client, session.workspaceId)
      knownWorkspaces.add(session.workspaceId)
    }
    await upsertSession(client, session)
  }
}

// Full rescan: upserts every workspace and session on disk and drops sessions
// (with their results and facts) that no longer exist.
const syncAll = async (writeDir = config.harnessWriteDir) => {
  const [workspaces, sessions] = await Promise.all([harness.listWorkspaces(writeDir), harness.describeAll(writeDir)])
  const ids = sessions.map((session) => session.id)
  await db.tx(async (client) => {
    for (const workspace of workspaces) await upsertWorkspace(client, workspace)
    await writeSessions(client, sessions, new Set(workspaces.map((workspace) => workspace.id)))
    await client.query('DELETE FROM sessions WHERE NOT (id = ANY($1::text[]))', [ids])
    await client.query(
      `DELETE FROM workspaces w
       WHERE NOT (w.id = ANY($1::text[]))
         AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.workspace_id = w.id)`,
      [workspaces.map((workspace) => workspace.id)],
    )
  })
  return ids
}

// Rescans one session. Returns its id, or null (and drops the row) when it is
// no longer on disk.
const syncSession = async (sessionId, writeDir = config.harnessWriteDir) => {
  const loc = await harness.locateSession(sessionId, writeDir)
  const session = loc && await harness.describeSession(loc)
  if (!session) {
    await db.query('DELETE FROM sessions WHERE id = $1', [sessionId])
    return null
  }
  const workspace = session.workspaceId ? await harness.readWorkspace(session.workspaceId, writeDir) : null
  await db.tx(async (client) => {
    const known = new Set()
    if (workspace && workspace.meta) {
      await upsertWorkspace(client, workspace)
      known.add(workspace.id)
    }
    await writeSessions(client, [session], known)
  })
  return session.id
}

// Session/metric pairs needing compute: no row, an older version, a different
// fingerprint, or an error/pending status. force returns every pair.
// sessionIds null means all registered sessions.
const stalePairs = async ({ sessionIds = null, metricNames = null, force = false } = {}) => {
  const selected = metricNames ? metricNames.map(metrics.get).filter(Boolean) : metrics.list()
  if (!selected.length || (sessionIds && !sessionIds.length)) return []
  const { rows } = await db.query(
    `SELECT s.id AS session_id, m.metric
     FROM sessions s
     CROSS JOIN unnest($1::text[], $2::int[]) AS m(metric, version)
     LEFT JOIN metric_results r ON r.session_id = s.id AND r.metric = m.metric
     WHERE ($3::text[] IS NULL OR s.id = ANY($3::text[]))
       AND ($4::boolean
            OR r.session_id IS NULL
            OR r.version < m.version
            OR r.status IN ('error', 'pending')
            OR r.source_fingerprint IS DISTINCT FROM s.source_fingerprint)
     ORDER BY s.updated_at DESC NULLS LAST, s.id, m.metric`,
    [selected.map((metric) => metric.name), selected.map((metric) => metric.version), sessionIds, Boolean(force)],
  )
  return rows.map((row) => ({ sessionId: row.session_id, metric: row.metric }))
}

module.exports = { syncAll, syncSession, stalePairs }
