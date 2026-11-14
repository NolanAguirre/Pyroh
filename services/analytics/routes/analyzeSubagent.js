const express = require('express')
const { analyzeSubagents } = require('../lib/analysis/subagentAnalysis')

const router = express.Router()

router.post('/:id/analyze-subagent', async (req, res) => {
  res.json(await analyzeSubagents(req.params.id, req.body?.assumptions))
})

module.exports = router
