// API-side connection to the pty host. Connects to the host socket, spawning a
// detached host when nothing answers, and reconnects with backoff if it drops.
const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const config = require('./config')
const paths = require('./store/paths')
const { createLineReader, encode } = require('./hostProtocol')

const HOST_ENTRY = path.join(__dirname, 'ptyHost', 'index.js')
const REQUEST_TIMEOUT = 5000
const CONNECT_ATTEMPTS = 50
const CONNECT_RETRY = 100
const RECONNECT_MIN = 250
const RECONNECT_MAX = 5000

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const createHostClient = () => {
  const data = Object.create(null)
  data.socket = null
  data.connecting = null
  data.pending = new Map()
  data.nextReqId = 1
  data.closed = false
  data.backoff = RECONNECT_MIN
  data.reconnectTimer = null
  data.eventHandlers = new Set()
  data.connectHandlers = new Set()
  data.disconnectHandlers = new Set()

  const connectOnce = () => new Promise((resolve, reject) => {
    const socket = net.createConnection(paths.ptyHostSocket())
    socket.once('connect', () => {
      socket.removeListener('error', reject)
      resolve(socket)
    })
    socket.once('error', reject)
  })

  // `detached` runs setsid, so the host leaves the process groups that
  // `make start` kills on Ctrl+C.
  const spawnHost = () => {
    fs.mkdirSync(paths.terminalsDir(), { recursive: true })
    const logFd = fs.openSync(paths.ptyHostLog(), 'a')
    try {
      const child = spawn(process.execPath, [HOST_ENTRY], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        cwd: os.homedir(),
        // The host runs from $HOME, so pin the already-resolved write dir.
        env: { ...process.env, HARNESS_WRITE_DIR: config.writeDir },
      })
      child.unref()
    } finally {
      fs.closeSync(logFd)
    }
  }

  const connect = async () => {
    try {
      return await connectOnce()
    } catch {
      spawnHost()
    }
    for (let attempt = 0; attempt < CONNECT_ATTEMPTS; attempt += 1) {
      await delay(CONNECT_RETRY)
      try {
        return await connectOnce()
      } catch {
        // Host still starting.
      }
    }
    throw new Error(`pty host did not start (see ${paths.ptyHostLog()})`)
  }

  const handleMessage = (message) => {
    if (message.reqId !== undefined) {
      const pending = data.pending.get(message.reqId)
      if (!pending) return
      data.pending.delete(message.reqId)
      clearTimeout(pending.timer)
      if (message.ok) pending.resolve(message.result)
      else pending.reject(Object.assign(new Error(message.error || 'pty host error'), { code: message.code }))
      return
    }
    data.eventHandlers.forEach((handler) => handler(message))
  }

  const scheduleReconnect = () => {
    if (data.closed || data.reconnectTimer) return
    const wait = data.backoff
    data.backoff = Math.min(data.backoff * 2, RECONNECT_MAX)
    data.reconnectTimer = setTimeout(() => {
      data.reconnectTimer = null
      ensure().catch((err) => {
        console.error(`pty host reconnect failed: ${err.message}`)
        scheduleReconnect()
      })
    }, wait)
    data.reconnectTimer.unref()
  }

  const handleClose = (socket) => {
    if (data.socket !== socket) return
    data.socket = null
    const error = new Error('pty host disconnected')
    data.pending.forEach((pending) => {
      clearTimeout(pending.timer)
      pending.reject(error)
    })
    data.pending.clear()
    data.disconnectHandlers.forEach((handler) => handler())
    scheduleReconnect()
  }

  const adopt = (socket) => {
    if (data.closed) {
      socket.destroy()
      throw new Error('pty host client closed')
    }
    socket.setEncoding('utf8')
    socket.on('data', createLineReader(handleMessage))
    socket.on('close', () => handleClose(socket))
    socket.on('error', () => socket.destroy())
    data.socket = socket
    data.backoff = RECONNECT_MIN
    data.connectHandlers.forEach((handler) => handler())
    return socket
  }

  const ensure = () => {
    if (data.socket) return Promise.resolve(data.socket)
    if (data.closed) return Promise.reject(new Error('pty host client closed'))
    if (!data.connecting) {
      data.connecting = connect()
        .then(adopt)
        .finally(() => { data.connecting = null })
    }
    return data.connecting
  }

  const request = async (type, payload = {}) => {
    const socket = await ensure()
    const reqId = data.nextReqId
    data.nextReqId += 1
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        data.pending.delete(reqId)
        reject(new Error(`pty host request timed out: ${type}`))
      }, REQUEST_TIMEOUT)
      data.pending.set(reqId, { resolve, reject, timer })
      socket.write(encode({ reqId, type, payload }))
    })
  }

  const subscribe = (set) => (handler) => {
    set.add(handler)
    return () => set.delete(handler)
  }

  const close = () => {
    data.closed = true
    if (data.reconnectTimer) clearTimeout(data.reconnectTimer)
    data.reconnectTimer = null
    if (data.socket) data.socket.end()
  }

  return {
    request,
    onEvent: subscribe(data.eventHandlers),
    onConnect: subscribe(data.connectHandlers),
    onDisconnect: subscribe(data.disconnectHandlers),
    close,
  }
}

module.exports = createHostClient()
module.exports.createHostClient = createHostClient
