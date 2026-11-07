const express = require('express')
const config = require('../config')
const workspaceStore = require('../store/workspaceStore')
const sessionIndex = require('../store/sessionIndex')
const routes = require('./routes')
const analyticsRoutes = require('./analyticsRoutes')
const { startMaintenance } = require('./maintenance')
const { UPLOAD_JSON_LIMIT } = require('../store/imageStore')

const createApp = () => {
  const app = express()
  app.post('/api/sessions/:id/images', express.json({ limit: UPLOAD_JSON_LIMIT, inflate: false }))
  app.use(express.json({ limit: '4mb' }))
  app.post('/api/provider-telemetry/codex/:captureId/v1/logs', require('../agents/providers/codexTelemetry').receive)
  app.use('/mcp/agents', require('./delegationMcp'))
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
  let reconciled
  sessionIndex.waitForInitialSeed(new Promise(resolve => { reconciled = resolve }))
  const app = createApp()
  let stopMaintenance = () => {}
  const server = app.listen(config.port, config.host, () => {
    process.stdout.write(`harness API listening on http://${config.host}:${config.port}\n`)
    process.stdout.write(`write-dir: ${config.writeDir}\n`)
    stopMaintenance = startMaintenance({ onReconciled: reconciled })
  })
  const stop = () => {
    stopMaintenance()
    server.close()
    server.closeAllConnections()
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  process.once('exit', () => stopMaintenance())
  server.once('close', () => {
    stopMaintenance()
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  })
  return server
}

if (require.main === module) start()

module.exports = { createApp, start }
