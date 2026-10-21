const express = require('express')
const jobs = require('../lib/jobs')
const { parseCount } = require('../lib/filters')

const router = express.Router()

router.get('/', async (req, res) => {
  const limit = parseCount(req.query.limit, 'limit', 50, 500)
  const offset = parseCount(req.query.offset, 'offset', 0)
  res.json({ jobs: await jobs.listJobs({ limit, offset }) })
})

router.get('/:id', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'invalid job id' })
  const job = await jobs.getJob(req.params.id)
  if (!job) return res.status(404).json({ error: 'job not found' })
  res.json({ job })
})

module.exports = router
