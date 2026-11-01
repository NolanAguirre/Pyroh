const express = require('express')
const config = require('../config')
const memoryRoutes = require('./memoryRoutes')

const createApp = () => {
  const app = express()
  app.get('/health', (_req, res) => res.json({ ok: true }))
  app.use('/api/memory', memoryRoutes)
  app.use((err, _req, res, _next) => {
    const status = err.httpStatus || err.status || 500
    res.status(status).json({ error: err.message || String(err) })
  })
  return app
}

const start = () => createApp().listen(config.port, config.host, () => {
  process.stdout.write(`memory API listening on http://${config.host}:${config.port}\n`)
  process.stdout.write(`write-dir: ${config.writeDir}\n`)
})

if (require.main === module) start()

module.exports = { createApp, start }
