const express = require('express')
const terminalStore = require('../store/terminalStore')

const router = express.Router()

router.post('/:id/run', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store')
    res.json({ terminal: await terminalStore.run(req.params.id, req.body || {}) })
  } catch (err) {
    res.status(err.httpStatus || 500).json({ error: err.message })
  }
})

module.exports = router
