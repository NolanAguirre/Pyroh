const express = require('express')

const router = express.Router()

router.get('/', (_req, res) => {
  res.json({ status: 'ok', queue_dir: process.env.QUEUE_DIR || null })
})

module.exports = router
