const express = require('express')
const analytics = require('../analytics/client')
const codeStats = require('../analytics/codeStats')

const router = express.Router()

const QUERY_KEYS = ['since', 'until', 'bucket', 'by', 'top', 'workspace', 'wid', 'session', 'provider', 'tool']

const readQuery = (query) => {
  const raw = {}
  for (const key of QUERY_KEYS) {
    const value = query[key]
    if (value === undefined) continue
    raw[key] = Array.isArray(value) ? value.join(',') : String(value)
  }
  return raw
}

// Tool-call metrics aggregated by the analytics service. Query params mirror
// `harness tool-stats` flags; since/until accept ISO dates or 30m|24h|7d|4w.
router.get('/tool-calls', async (req, res) => {
  try {
    res.json({ stats: await analytics.toolStats(readQuery(req.query)) })
  } catch (err) {
    res.status(err.httpStatus || 500).json({ error: err && err.message ? err.message : String(err) })
  }
})

// Rescan sessions and recompute stale metrics. Body: { sessionId?, compute? }.
router.post('/sync', async (req, res) => {
  const { sessionId, compute } = req.body || {}
  try {
    res.status(202).json(await analytics.sync({ sessionId, compute }))
  } catch (err) {
    res.status(err.httpStatus || 500).json({ error: err && err.message ? err.message : String(err) })
  }
})

// Deterministic per-file line counts for a workspace (node_modules, .git,
// package manifests/lockfiles, hidden, and gitignored files excluded).
// Aggregation happens client-side.
router.get('/code-stats', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  try {
    res.json({ stats: await codeStats.codeStats({ workspace: req.query.workspace }) })
  } catch (err) {
    res.status(err.httpStatus || 500).json({ error: err && err.message ? err.message : String(err) })
  }
})

module.exports = router
