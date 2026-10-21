const express = require('express')
const { isSafePart, isJobId, enqueueJob, readJob } = require('../lib/queue')

const router = express.Router()

const CALLBACK_METHODS = ['POST', 'PUT', 'PATCH']

const parseCallback = (callback) => {
  if (callback === undefined || callback === null) return { value: null }
  if (typeof callback !== 'object' || typeof callback.url !== 'string') {
    return { error: 'callback.url must be a string' }
  }
  let url
  try {
    url = new URL(callback.url)
  } catch {
    return { error: 'callback.url must be a valid URL' }
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { error: 'callback.url must be http or https' }
  }
  const method = (callback.method || 'POST').toUpperCase()
  if (!CALLBACK_METHODS.includes(method)) {
    return { error: `callback.method must be one of ${CALLBACK_METHODS.join(', ')}` }
  }
  return { value: { url: url.toString(), method } }
}

const createJob = async (req, res) => {
  const { task, key, input, callback } = req.body || {}
  if (!isSafePart(task)) return res.status(400).json({ error: 'task must match [A-Za-z0-9._-]{1,128}' })
  if (!isSafePart(key)) return res.status(400).json({ error: 'key must match [A-Za-z0-9._-]{1,128}' })
  if (typeof input !== 'string' || !input.trim()) return res.status(400).json({ error: 'input is required' })
  const parsed = parseCallback(callback)
  if (parsed.error) return res.status(400).json({ error: parsed.error })

  try {
    const job = await enqueueJob({ task, key, input, callback: parsed.value })
    return res.status(202).json({ job })
  } catch (error) {
    console.error('Error enqueueing job:', error)
    return res.status(500).json({ error: 'Failed to enqueue job' })
  }
}

const getJob = async (req, res) => {
  if (!isJobId(req.params.id)) return res.status(400).json({ error: 'invalid job id' })
  try {
    const job = await readJob(req.params.id)
    if (!job) return res.status(404).json({ error: 'job not found' })
    return res.json({ job })
  } catch (error) {
    console.error('Error reading job:', error)
    return res.status(500).json({ error: 'Failed to read job' })
  }
}

router.post('/', createJob)
router.get('/:id', getJob)

module.exports = router
