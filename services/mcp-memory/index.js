const http = require('http')
const config = require('./lib/config')
const { handleMessage } = require('./lib/mcp')
const { isSessionId } = require('./lib/store')

const MAX_BODY_BYTES = 1024 * 1024

// Streamable HTTP MCP, JSON responses only. The harness points each agent at
// /mcp/<sourceSessionId>/<memorySessionId>, so the URL decides where memories go.
const ROUTE = /^\/mcp\/([^/]+)\/([^/]+)\/?$/

const send = (res, status, body) => {
  if (body === undefined) {
    res.writeHead(status)
    return res.end()
  }
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) })
  res.end(text)
}

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = []
  let size = 0
  req.on('data', (chunk) => {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      reject(Object.assign(new Error('request body too large'), { status: 413 }))
      req.destroy()
      return
    }
    chunks.push(chunk)
  })
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  req.on('error', reject)
})

const handleMcp = async (req, res, context) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return send(res, 405, { error: 'only POST is supported' })
  }
  let payload
  try {
    payload = JSON.parse(await readBody(req))
  } catch (err) {
    if (err.status) return send(res, err.status, { error: err.message })
    return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })
  }
  const messages = Array.isArray(payload) ? payload : [payload]
  const responses = (await Promise.all(messages.map((message) => handleMessage(message, context)))).filter(Boolean)
  if (!responses.length) return send(res, 202)
  return send(res, 200, Array.isArray(payload) ? responses : responses[0])
}

const handle = async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost')
  if (pathname === '/health') return send(res, 200, { ok: true })
  const match = ROUTE.exec(pathname)
  if (!match) return send(res, 404, { error: 'expected /mcp/<sourceSessionId>/<memorySessionId>' })
  const [sourceSessionId, memorySessionId] = match.slice(1).map(decodeURIComponent)
  if (!isSessionId(sourceSessionId) || !isSessionId(memorySessionId)) return send(res, 400, { error: 'invalid session id' })
  return handleMcp(req, res, { sourceSessionId, memorySessionId })
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err)
    if (!res.headersSent) send(res, 500, { error: err.message })
  })
})

server.listen(config.port, config.host, () => {
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
