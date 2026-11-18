const express = require('express')
const { replaySubagents } = require('../lib/analysis/subagentAnalysis')

const router = express.Router()

router.post('/:id/subagent-replay', async (req, res) => {
  const replay = await replaySubagents(req.params.id, req.body?.assumptions)
  res.json({ replay })
})

module.exports = router
