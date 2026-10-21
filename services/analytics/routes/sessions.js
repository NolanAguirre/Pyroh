const express = require('express')
const db = require('../lib/db')
const sync = require('../lib/sync')
const metrics = require('../lib/metrics')
const { parseTime } = require('../lib/aggregate/toolCalls')
const { invalid, parseBool, parseCount, sessionClauses, whereSql } = require('../lib/filters')

const toSession = (row) => ({
  id: row.id,
  workspaceId: row.workspace_id,
  workspaceName: row.workspace_name,
  name: row.name,
  provider: row.provider,
  model: row.model,
  cwd: row.cwd,
  archived: row.archived,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  sessionDir: row.session_dir,
  eventsPath: row.events_path,
  transcriptPaths: row.transcript_paths,
  sourceFingerprint: row.source_fingerprint,
  discoveredAt: row.discovered_at,
  syncedAt: row.synced_at,
})

// Shared by /sessions and /results/:metric.
const parseSessionQuery = (query) => {
  let since
  let until
  try {
    since = parseTime(query.since)
    until = parseTime(query.until)
  } catch (err) {
    throw invalid(err.message)
  }
  return {
    filters: {
      workspace: query.workspace,
      session: query.session,
      provider: query.provider,
      since,
      until,
      archived: parseBool(query.archived, 'archived'),
    },
    limit: parseCount(query.limit, 'limit', 100, 1000),
    offset: parseCount(query.offset, 'offset', 0),
  }
}

const SESSION_FROM = 'sessions s LEFT JOIN workspaces w ON w.id = s.workspace_id'

const createSessionsRouter = ({ queue }) => {
  const router = express.Router()

  router.get('/', async (req, res) => {
    const { filters, limit, offset } = parseSessionQuery(req.query)
    const params = []
    const where = whereSql(sessionClauses(filters, params))
    const [{ rows }, count] = await Promise.all([
      db.query(
        `SELECT s.*, w.name AS workspace_name FROM ${SESSION_FROM} ${where}
         ORDER BY s.updated_at DESC NULLS LAST, s.id
         LIMIT ${limit} OFFSET ${offset}`,
        params,
      ),
      db.query(`SELECT count(*)::int AS total FROM ${SESSION_FROM} ${where}`, params),
    ])
    res.json({ total: count.rows[0].total, limit, offset, sessions: rows.map(toSession) })
  })

  router.get('/:id', async (req, res) => {
    const { rows } = await db.query(
      `SELECT s.*, w.name AS workspace_name FROM ${SESSION_FROM} WHERE s.id = $1`,
      [req.params.id],
    )
    if (!rows[0]) return res.status(404).json({ error: 'session not found' })
    const session = rows[0]
    const results = await db.query(
      `SELECT metric, version, status, error, source_fingerprint, computed_at, duration_ms
       FROM metric_results WHERE session_id = $1`,
      [session.id],
    )
    const byMetric = new Map(results.rows.map((row) => [row.metric, row]))
    const metricStatus = metrics.list().map((metric) => {
      const row = byMetric.get(metric.name)
      const fresh = row && row.status === 'ok' && row.version >= metric.version
        && JSON.stringify(row.source_fingerprint) === JSON.stringify(session.source_fingerprint)
      return {
        metric: metric.name,
        currentVersion: metric.version,
        version: row ? row.version : null,
        status: row ? row.status : 'missing',
        stale: !fresh,
        error: row ? row.error : null,
        computedAt: row ? row.computed_at : null,
        durationMs: row ? row.duration_ms : null,
      }
    })
    res.json({ session: { ...toSession(session), meta: session.meta }, metrics: metricStatus })
  })

  router.get('/:id/results/:metric', async (req, res) => {
    const { rows } = await db.query(
      `SELECT session_id, metric, version, status, result, error, computed_at, duration_ms
       FROM metric_results WHERE session_id = $1 AND metric = $2`,
      [req.params.id, req.params.metric],
    )
    const row = rows[0]
    if (!row) return res.status(404).json({ error: 'result not found' })
    res.json({
      sessionId: row.session_id,
      metric: row.metric,
      version: row.version,
      status: row.status,
      error: row.error,
      computedAt: row.computed_at,
      durationMs: row.duration_ms,
      result: row.result,
    })
  })

  // Harness hook after a run: sync one session and queue its stale metrics.
  router.post('/:id/notify', async (req, res) => {
    const id = await sync.syncSession(req.params.id)
    if (!id) return res.status(404).json({ error: `session not found: ${req.params.id}` })
    const job = await queue.enqueue({
      kind: 'notify',
      params: { sessionId: id },
      pairs: await sync.stalePairs({ sessionIds: [id] }),
    })
    res.status(202).json({ job })
  })

  return router
}

module.exports = { createSessionsRouter, parseSessionQuery, SESSION_FROM }
