const express = require('express')
const terminalStore = require('../store/terminalStore')

const router = express.Router()

router.get('/:id', (req, res) => {
  try {
    res.set('Cache-Control', 'no-store')
    res.json({ terminal: terminalStore.get(req.params.id, req.query.workspace, req.query.session) })
  } catch (err) {
    res.status(err.httpStatus || 500).json({ error: err.message })
  }
})

module.exports = router
