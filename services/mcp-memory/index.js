const express = require('express')
const config = require('./lib/config')
const { handleMessage } = require('./lib/mcp')
const { isSessionId } = require('./lib/store')

// Streamable HTTP MCP, JSON responses only. The harness points each agent at
// /mcp/<sourceSessionId>/<memorySessionId>, so the URL decides where memories go.
const MCP_PATH = '/mcp/:sourceSessionId/:memorySessionId'

const jsonParser = express.json({ limit: '1mb' })

const parseError = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }

const app = express()

app.all('/health', (_req, res) => {
  res.json({ ok: true })
})

app.use(MCP_PATH, (req, res, next) => {
  const { sourceSessionId, memorySessionId } = req.params
  if (!isSessionId(sourceSessionId) || !isSessionId(memorySessionId)) {
    res.status(400).json({ error: 'invalid session id' })
    return
  }
  next()
})

app.post(MCP_PATH, jsonParser, async (req, res) => {
  if (req.body === undefined) {
    res.status(400).json(parseError)
    return
  }
  const { sourceSessionId, memorySessionId } = req.params
  const payload = req.body
  const messages = Array.isArray(payload) ? payload : [payload]
  const responses = (await Promise.all(messages.map((message) => handleMessage(message, { sourceSessionId, memorySessionId })))).filter(Boolean)
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
  res.status(404).json({ error: 'expected /mcp/<sourceSessionId>/<memorySessionId>' })
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
  console.log(`mcp-memory running at http://${config.host}:${config.port}/mcp (memories in ${config.writeDir})`)
})

const shutdown = (signal) => {
  console.log(`Received ${signal}, shutting down`)
  server.close(() => process.exit(0))
  server.closeAllConnections()
  setTimeout(() => process.exit(1), 5000).unref()
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
