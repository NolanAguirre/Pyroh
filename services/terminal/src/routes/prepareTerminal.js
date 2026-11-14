const express = require('express')
const terminalStore = require('../store/terminalStore')

const router = express.Router()

router.post('/prepare', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store')
    res.json({ terminal: await terminalStore.prepare(req.body?.ticket) })
  } catch (err) {
    res.status(err.httpStatus || 500).json({ error: err.message })
  }
})

module.exports = router
