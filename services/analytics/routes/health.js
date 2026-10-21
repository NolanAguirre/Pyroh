const express = require('express')
const db = require('../lib/db')

const router = express.Router()

router.get('/', async (_req, res) => {
  try {
    await db.query('SELECT 1')
    res.json({ status: 'ok', db: 'ok' })
  } catch (err) {
    res.status(503).json({ status: 'degraded', db: err.message })
  }
})

module.exports = router
