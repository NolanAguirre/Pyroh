const express = require('express')
const { listSubagentSessions } = require('../lib/analysis/subagentAnalysis')

const router = express.Router()

router.get('/', async (_req, res) => {
  res.json({ sessions: await listSubagentSessions() })
})

module.exports = router
