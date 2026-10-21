const express = require('express')
const sync = require('../lib/sync')

// POST /sync { sessionId?, compute=true }: rescan disk, upsert the registry,
// and queue stale session/metric pairs.
const createSyncRouter = ({ queue }) => {
  const router = express.Router()

  router.post('/', async (req, res) => {
    const { sessionId = null, compute = true } = req.body || {}
    if (sessionId !== null && typeof sessionId !== 'string') {
      return res.status(400).json({ error: 'sessionId must be a string' })
    }
    const ids = sessionId ? [await sync.syncSession(sessionId)].filter(Boolean) : await sync.syncAll()
    if (sessionId && !ids.length) return res.status(404).json({ error: `session not found: ${sessionId}` })
    const job = compute === false
      ? null
      : await queue.enqueue({ kind: 'sync', params: { sessionId }, pairs: await sync.stalePairs({ sessionIds: ids }) })
    res.status(job ? 202 : 200).json({ sessions: ids.length, job })
  })

  return router
}

module.exports = createSyncRouter
