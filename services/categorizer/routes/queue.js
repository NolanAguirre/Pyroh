const express = require('express')
const { readQueueStatus } = require('../lib/queue')

const router = express.Router()

const SERVICE = 'categorizer'

const queueStatus = async (req, res) => {
  try {
    const status = await readQueueStatus(req.query.limit)
    return res.json({ service: SERVICE, ...status })
  } catch (error) {
    console.error('Error reading queue status:', error)
    return res.status(500).json({ error: 'Failed to read queue status' })
  }
}

router.get('/', queueStatus)

module.exports = router
