const express = require('express')
const config = require('../config')
const fsRoutes = require('./fsRoutes')

const createApp = () => {
  const app = express()
  app.use('/api/editor', fsRoutes)
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || String(err) })
  })
  app.get('/health', (_req, res) => res.json({ ok: true }))
  return app
}

const start = () => createApp().listen(config.port, config.host, () => {
  process.stdout.write(`editor API listening on http://${config.host}:${config.port}\n`)
  process.stdout.write(`write-dir: ${config.writeDir}\n`)
})

if (require.main === module) start()

module.exports = { createApp, start }
