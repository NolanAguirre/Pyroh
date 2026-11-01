const express = require('express')
const config = require('./lib/config')
const { handleMessage } = require('./lib/mcp')
const { isRouteId } = require('./lib/store')

// Streamable HTTP MCP, JSON responses only. The harness points each agent at
// /mcp/<workspaceId>[/<sessionId>], so the URL decides who the ids are issued to.
const MCP_PATH = '/mcp/:workspaceId{/:sessionId}'

const jsonParser = express.json({ limit: '1mb' })

const parseError = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }

const app = express()

app.all('/health', (_req, res) => {
  res.json({ ok: true })
})

app.use(MCP_PATH, (req, res, next) => {
  const { workspaceId, sessionId } = req.params
  if (!isRouteId(workspaceId) || (sessionId !== undefined && !isRouteId(sessionId))) {
    res.status(400).json({ error: 'invalid workspace or session id' })
    return
  }
  next()
})

app.post(MCP_PATH, jsonParser, async (req, res) => {
  if (req.body === undefined) {
    res.status(400).json(parseError)
    return
  }
  const context = { workspaceId: req.params.workspaceId, sessionId: req.params.sessionId || null }
  const payload = req.body
  const messages = Array.isArray(payload) ? payload : [payload]
  const responses = (await Promise.all(messages.map((message) => handleMessage(message, context)))).filter(Boolean)
  if (!responses.length) {
    res.status(202).end()
    return
  }
  res.json(Array.isArray(payload) ? responses : responses[0])
})

app.all(MCP_PATH, (_req, res) => {
  res.set('Allow', 'POST')
  res.status(405).json({ error: 'only POST is supported' })
})

app.use((_req, res) => {
  res.status(404).json({ error: 'expected /mcp/<workspaceId>[/<sessionId>]' })
})

app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') {
    res.status(400).json(parseError)
    return
  }
  if (err.type === 'entity.too.large' || err.status === 413) {
    res.status(413).json({ error: 'request body too large' })
    return
  }
  console.error(err)
  if (res.headersSent) return
  res.status(500).json({ error: err.message })
})

const server = app.listen(config.port, config.host, () => {
  console.log(`mcpdevid running at http://${config.host}:${config.port}/mcp (db ${config.dbFile})`)
})

const shutdown = (signal) => {
  console.log(`Received ${signal}, shutting down`)
  server.close(() => process.exit(0))
  server.closeAllConnections()
  setTimeout(() => process.exit(1), 5000).unref()
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
