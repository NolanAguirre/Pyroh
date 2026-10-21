const express = require('express')
const toolCalls = require('../lib/aggregate/toolCalls')

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

// Same params as the harness /api/analytics/tool-calls; since/until accept
// ISO dates or 30m|24h|7d|4w.
router.get('/tool-calls', async (req, res) => {
  const options = toolCalls.parseOptions(readQuery(req.query))
  res.json({ stats: await toolCalls.toolStats(options) })
})

module.exports = router
