const express = require('express')
const db = require('../lib/db')
const sync = require('../lib/sync')
const metrics = require('../lib/metrics')
const { toList } = require('../lib/filters')

// POST /compute { metrics?, sessions?, workspace?, force? }: queue the stale
// (or, with force, all) pairs for the selected metrics and sessions.
const createComputeRouter = ({ queue }) => {
  const router = express.Router()

  router.post('/', async (req, res) => {
    const body = req.body || {}
    const metricNames = toList(body.metrics)
    const unknown = (metricNames || []).filter((name) => !metrics.get(name))
    if (unknown.length) return res.status(400).json({ error: `unknown metrics: ${unknown.join(', ')}` })

    let sessionIds = toList(body.sessions)
    const workspaces = toList(body.workspace)
    if (workspaces) {
      const { rows } = await db.query(
        `SELECT s.id FROM sessions s LEFT JOIN workspaces w ON w.id = s.workspace_id
         WHERE (s.workspace_id = ANY($1::text[]) OR w.name = ANY($1::text[]))
           AND ($2::text[] IS NULL OR s.id = ANY($2::text[]))`,
        [workspaces, sessionIds],
      )
      sessionIds = rows.map((row) => row.id)
    }

    const force = Boolean(body.force)
    const job = await queue.enqueue({
      kind: 'compute',
      params: { metrics: metricNames, sessions: toList(body.sessions), workspace: workspaces, force },
      pairs: await sync.stalePairs({ sessionIds, metricNames, force }),
    })
    res.status(202).json({ job })
  })

  return router
}

module.exports = createComputeRouter
