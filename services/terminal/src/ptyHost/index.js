// Long-lived pty host. Owns the shells so the terminal API can restart freely.
// Launched detached (its own session) by the API; `--foreground` keeps Ctrl+C
// working when run by hand for debugging.
const fs = require('fs')
const net = require('net')
const paths = require('../store/paths')
const { createLineReader, encode } = require('../hostProtocol')
const { createPtyStore } = require('./ptyStore')

const FOREGROUND = process.argv.includes('--foreground')

const log = (line) => process.stdout.write(`[pty-host ${new Date().toISOString()}] ${line}\n`)

const createPtyHost = () => {
  const data = Object.create(null)
  data.clients = new Set()
  data.server = null
  data.stopping = false
  data.socketPath = paths.ptyHostSocket()
  data.pidFile = paths.ptyHostPidFile()

  const broadcast = (message) => {
    const line = encode(message)
    data.clients.forEach((socket) => {
      if (!socket.destroyed) socket.write(line)
    })
  }

  const store = createPtyStore({
    onOutput: (id, chunk) => broadcast({ type: 'output', id, data: chunk }),
    onExit: (id, code) => broadcast({ type: 'exit', id, code }),
  })

  const handlers = {
    create: (payload) => store.create(payload),
    list: () => store.list(),
    snapshot: ({ id }) => store.snapshot(id),
    write: ({ id, data: chunk }) => store.write(id, chunk),
    resize: ({ id, cols, rows }) => store.resize(id, cols, rows),
    kill: ({ id }) => store.kill(id),
    shutdown: () => {
      setImmediate(() => stop('shutdown request'))
      return null
    },
  }

  const handleRequest = (socket, message) => {
    const { reqId, type } = message
    const reply = (body) => {
      if (!socket.destroyed) socket.write(encode({ reqId, ...body }))
    }
    const handler = Object.prototype.hasOwnProperty.call(handlers, type) ? handlers[type] : null
    if (!handler) return reply({ ok: false, error: `Unknown request: ${type}` })
    try {
      const result = handler(message.payload || {})
      reply({ ok: true, result: result === undefined ? null : result })
    } catch (err) {
      reply({ ok: false, error: err && err.message ? err.message : String(err), code: err && err.code })
    }
  }

  const handleConnection = (socket) => {
    data.clients.add(socket)
    socket.setEncoding('utf8')
    socket.on('data', createLineReader((message) => handleRequest(socket, message)))
    socket.on('close', () => data.clients.delete(socket))
    socket.on('error', () => data.clients.delete(socket))
  }

  const removeFile = (file, expected) => {
    try {
      if (expected !== undefined && fs.readFileSync(file, 'utf8').trim() !== expected) return
      fs.unlinkSync(file)
    } catch {
      // Already gone.
    }
  }

  const stop = (reason) => {
    if (data.stopping) return
    data.stopping = true
    log(`stopping: ${reason}`)
    store.killAll()
    data.clients.forEach((socket) => socket.destroy())
    if (data.server) data.server.close()
    removeFile(data.socketPath)
    removeFile(data.pidFile, String(process.pid))
    process.exit(0)
  }

  const listening = () => {
    fs.writeFileSync(data.pidFile, `${process.pid}\n`)
    log(`listening on ${data.socketPath} (pid ${process.pid})`)
  }

  // Single instance: a live socket means another host owns it; a dead one is stale.
  const handleListenError = (err) => {
    if (err.code !== 'EADDRINUSE') {
      log(`listen failed: ${err.message}`)
      process.exit(1)
    }
    const probe = net.createConnection(data.socketPath)
    probe.once('connect', () => {
      probe.destroy()
      log('another pty host is running; exiting')
      process.exit(0)
    })
    probe.once('error', () => {
      removeFile(data.socketPath)
      data.server.listen(data.socketPath)
    })
  }

  const start = () => {
    fs.mkdirSync(paths.terminalsDir(), { recursive: true })
    data.server = net.createServer(handleConnection)
    data.server.on('listening', listening)
    data.server.on('error', handleListenError)
    data.server.listen(data.socketPath)

    process.on('SIGTERM', () => stop('SIGTERM'))
    process.on('SIGHUP', () => {})
    process.on('SIGINT', FOREGROUND ? () => stop('SIGINT') : () => {})
  }

  return { start, stop }
}

if (require.main === module) createPtyHost().start()

module.exports = { createPtyHost }
