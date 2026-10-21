const express = require('express')
const db = require('../lib/db')
const metrics = require('../lib/metrics')
const { parseSessionQuery, SESSION_FROM } = require('./sessions')
const { sessionClauses, whereSql } = require('../lib/filters')

const router = express.Router()

// Cached results for one metric across sessions; filters as /sessions.
router.get('/:metric', async (req, res) => {
  const metric = metrics.get(req.params.metric)
  if (!metric) return res.status(404).json({ error: `unknown metric: ${req.params.metric}` })
  const { filters, limit, offset } = parseSessionQuery(req.query)
  const params = [metric.name]
  const clauses = sessionClauses(filters, params)
  const { rows } = await db.query(
    `SELECT s.id AS session_id, s.workspace_id, w.name AS workspace_name, s.provider, s.updated_at,
            r.version, r.status, r.error, r.computed_at, r.result
     FROM ${SESSION_FROM}
     JOIN metric_results r ON r.session_id = s.id AND r.metric = $1
     ${whereSql(clauses)}
     ORDER BY s.updated_at DESC NULLS LAST, s.id
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  )
  res.json({
    metric: metric.name,
    version: metric.version,
    limit,
    offset,
    results: rows.map((row) => ({
      sessionId: row.session_id,
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
      provider: row.provider,
      updatedAt: row.updated_at,
      version: row.version,
      status: row.status,
      error: row.error,
      computedAt: row.computed_at,
      result: row.result,
    })),
  })
})

module.exports = router
