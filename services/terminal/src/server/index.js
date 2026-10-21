const express = require('express')
const { WebSocketServer } = require('ws')
const config = require('../config')
const terminalStore = require('../store/terminalStore')
const terminalRoutes = require('./terminalRoutes')

const TERMINAL_SOCKET = /^\/api\/terminal\/([^/]+)\/socket$/

const createApp = () => {
  const app = express()
  app.use(express.json({ limit: '4mb' }))
  app.use('/api/terminal', terminalRoutes)
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || String(err) })
  })
  app.get('/health', (_req, res) => res.json({ ok: true }))
  return app
}

const handleUpgrade = (wss) => (req, socket, head) => {
  let pathname = ''
  try {
    pathname = new URL(req.url, 'http://localhost').pathname
  } catch {
    // Fall through to destroy.
  }
  const match = TERMINAL_SOCKET.exec(pathname)
  if (!match) {
    socket.destroy()
    return
  }
  let id
  try { id = decodeURIComponent(match[1]) } catch { socket.destroy(); return }
  wss.handleUpgrade(req, socket, head, (ws) => terminalStore.attach(id, ws))
}

const start = async () => {
  await terminalStore.init()
  const app = createApp()
  const server = app.listen(config.port, config.host, () => {
    process.stdout.write(`terminal API listening on http://${config.host}:${config.port}\n`)
    process.stdout.write(`write-dir: ${config.writeDir}\n`)
  })
  const wss = new WebSocketServer({ noServer: true })
  let stopping = false
  const connections = new Set()
  server.on('connection', (socket) => {
    connections.add(socket)
    socket.on('close', () => connections.delete(socket))
  })
  server.on('upgrade', (req, socket, head) => {
    if (stopping) return socket.destroy()
    handleUpgrade(wss)(req, socket, head)
  })
  const shutdown = () => {
    if (stopping) return
    stopping = true
    terminalStore.shutdown()
    // Allow close frames to flush, then terminate peers that do not respond.
    const timer = setTimeout(() => {
      wss.clients.forEach((socket) => socket.terminate())
      connections.forEach((socket) => socket.destroy())
    }, 1000)
    timer.unref()
    wss.close()
    server.close(() => {
      process.removeListener('SIGINT', shutdown)
      process.removeListener('SIGTERM', shutdown)
    })
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  return server
}

if (require.main === module) {
  start().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

module.exports = { createApp, start }
