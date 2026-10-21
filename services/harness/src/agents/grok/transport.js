const { spawn } = require('child_process')
const readline = require('readline')

const rpcError = (error) => Object.assign(new Error(error.message || JSON.stringify(error)), { code: error.code, data: error.data })

// JSON-RPC 2.0 over the stdio of one `grok agent stdio` process. Never attach
// to a shared leader; each driver owns its process group.
const createTransport = ({ bin, args = [], env, onNotification, onRequest, onFailure, timeoutMs = 60000 }) => {
  let child = null
  let lines = null
  let nextId = 0
  let failure = null
  let closing = false
  let exited = Promise.resolve()
  const pending = new Map()

  const fail = (err) => {
    if (failure) return
    failure = err
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(err)
    }
    pending.clear()
    if (!closing) onFailure?.(err)
  }

  const write = (message) => {
    if (failure) throw failure
    if (!child || child.stdin.destroyed || closing) throw new Error('Grok connection is closed')
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
  }

  // `timeoutMs: 0` disables the timeout for long-running calls such as prompts.
  const request = (method, params = {}, { timeoutMs: limit = timeoutMs } = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = limit ? setTimeout(() => fail(new Error(`Grok request timed out: ${method}`)), limit) : null
    pending.set(id, { resolve, reject, timer })
    try {
      write({ id, method, params })
    } catch (err) {
      clearTimeout(timer)
      pending.delete(id)
      reject(err)
    }
  })

  const notify = (method, params = {}) => write({ method, params })

  const respond = (id, result) => {
    if (!failure && !closing) write({ id, result })
  }

  const respondError = (id, err) => {
    if (!failure && !closing) write({ id, error: { code: err.code || -32603, message: err.message } })
  }

  const onLine = (line) => {
    if (!line.trim()) return
    let message
    try {
      message = JSON.parse(line)
    } catch (err) {
      return fail(new Error(`Grok protocol error: ${err.message}`))
    }
    if (message.method && message.id != null) {
      Promise.resolve()
        .then(() => onRequest(message))
        .then((result) => respond(message.id, result ?? null), (err) => respondError(message.id, err))
        .catch(fail)
    } else if (message.method) {
      try { onNotification(message.method, message.params || {}) } catch (err) { fail(err) }
    } else if (message.id != null) {
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      clearTimeout(entry.timer)
      if (message.error) entry.reject(rpcError(message.error))
      else entry.resolve(message.result)
    }
  }

  const start = () => {
    if (child) return
    child = spawn(bin, args, {
      env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    })
    exited = new Promise((resolve) => {
      child.once('close', (code, signal) => {
        fail(new Error(`Grok agent exited (${signal || code})`))
        resolve()
      })
    })
    child.once('error', (err) => fail(new Error(`Cannot start Grok (${bin}): ${err.message}. Install the Grok CLI or set HARNESS_GROK_BIN.`)))
    child.stdin.on('error', fail)
    child.stdout.on('error', fail)
    // Diagnostics go to the daemon log, never into the JSON-RPC parser.
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => process.stderr.write(chunk))
    lines = readline.createInterface({ input: child.stdout })
    lines.on('line', onLine)
  }

  const kill = (signal) => {
    if (!child?.pid) return
    try {
      if (process.platform === 'win32') child.kill(signal)
      else process.kill(-child.pid, signal)
    } catch (err) {
      if (err.code !== 'ESRCH') throw err
    }
  }

  const close = async () => {
    if (closing) return exited
    closing = true
    fail(new Error('Grok connection closed'))
    if (!child) return
    child.stdin.destroy()
    kill('SIGTERM')
    const timer = setTimeout(() => kill('SIGKILL'), 2000)
    try { await exited } finally { clearTimeout(timer); lines?.close() }
  }

  return { start, request, notify, close }
}

module.exports = { createTransport }
