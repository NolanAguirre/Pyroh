const express = require('express')
const db = require('../lib/db')
const sync = require('../lib/sync')
const metrics = require('../lib/metrics')

const countStatus = async (metric) => {
  const { rows } = await db.query(
    `SELECT count(*)::int AS sessions,
            count(*) FILTER (WHERE r.session_id IS NULL)::int AS missing,
            count(*) FILTER (WHERE r.status = 'error')::int AS error,
            count(*) FILTER (WHERE r.status = 'running')::int AS running,
            count(*) FILTER (WHERE r.status = 'ok' AND r.version >= $2
                             AND r.source_fingerprint IS NOT DISTINCT FROM s.source_fingerprint)::int AS ok
     FROM sessions s
     LEFT JOIN metric_results r ON r.session_id = s.id AND r.metric = $1`,
    [metric.name, metric.version],
  )
  const counts = rows[0]
  return { ...counts, stale: counts.sessions - counts.ok - counts.error - counts.missing }
}

const createMetricsRouter = ({ queue }) => {
  const router = express.Router()

  router.get('/', async (_req, res) => {
    const list = await Promise.all(metrics.list().map(async (metric) => ({
      name: metric.name,
      version: metric.version,
      counts: await countStatus(metric),
    })))
    res.json({ metrics: list, queue: queue.stats() })
  })

  // { force? }: queue every stale session for the metric, or every session.
  router.post('/:metric/backfill', async (req, res) => {
    const metric = metrics.get(req.params.metric)
    if (!metric) return res.status(404).json({ error: `unknown metric: ${req.params.metric}` })
    const force = Boolean(req.body && req.body.force)
    const job = await queue.enqueue({
      kind: 'backfill',
      params: { metric: metric.name, version: metric.version, force },
      pairs: await sync.stalePairs({ metricNames: [metric.name], force }),
    })
    res.status(202).json({ job })
  })

  return router
}

module.exports = createMetricsRouter
