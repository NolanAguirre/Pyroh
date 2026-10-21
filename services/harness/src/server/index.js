const express = require('express')
const config = require('../config')
const workspaceStore = require('../store/workspaceStore')
const sessionIndex = require('../store/sessionIndex')
const routes = require('./routes')
const analyticsRoutes = require('./analyticsRoutes')

const RECONCILE_INTERVAL_MS = 60000

const reconcileSessions = () => sessionIndex.reconcile(config.writeDir).catch((err) => {
  process.stderr.write(`session index reconcile failed: ${err.message}\n`)
})

const createApp = () => {
  const app = express()
  app.use(express.json({ limit: '4mb' }))
  app.use('/api/analytics', analyticsRoutes)
  app.use('/api', routes)
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || String(err) })
  })
  app.get('/health', (_req, res) => res.json({ ok: true }))
  return app
}

const start = () => {
  workspaceStore.ensureLayout(config.writeDir)
  reconcileSessions()
  setInterval(reconcileSessions, RECONCILE_INTERVAL_MS).unref()
  const app = createApp()
  app.listen(config.port, config.host, () => {
    process.stdout.write(`harness API listening on http://${config.host}:${config.port}\n`)
    process.stdout.write(`write-dir: ${config.writeDir}\n`)
  })
}

if (require.main === module) start()

module.exports = { createApp, start }
