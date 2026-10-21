const { spawn } = require('child_process')
const readline = require('readline')

// One stdio app-server per driver. Never attach to the desktop's live server.
const createTransport = ({ binary, env, onNotification, onRequest, onFailure, onDiagnostic, timeoutMs = 30000 }) => {
  let child = null
  let lines = null
  let nextId = 0
  let failure = null
  let closing = false
  let exited = Promise.resolve()
  let stderrTail = ''
  let sandboxDiagnostic = null
  const pending = new Map()

  const withDiagnostics = (err) => sandboxDiagnostic
    ? new Error(`${err.message}\nCodex also reported: ${sandboxDiagnostic}`, { cause: err })
    : err

  const fail = (err) => {
    if (failure) return
    err = withDiagnostics(err)
    failure = err
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(err)
    }
    pending.clear()
    if (!closing) onFailure(err)
  }

  const write = (message) => {
    if (failure) throw failure
    if (!child || child.stdin.destroyed || closing) throw new Error('Codex connection is closed')
    child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => {
      fail(new Error(`Codex request timed out: ${method}`))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    try {
      write({ id, method, params })
    } catch (err) {
      clearTimeout(timer)
      pending.delete(id)
      reject(err)
    }
  })

  const start = async () => {
    if (child) return
    child = spawn(binary, ['app-server', '--listen', 'stdio://'], {
      env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    })
    exited = new Promise((resolve) => {
      child.once('close', (code, signal) => {
        fail(new Error(`Codex app-server exited (${signal || code})`))
        resolve()
      })
    })
    child.once('error', (err) => fail(new Error(`Cannot start Codex (${binary}): ${err.message}. Install Codex or set HARNESS_CODEX_BIN.`)))
    child.stdin.on('error', fail)
    child.stdout.on('error', fail)
    // Diagnostics go to the daemon log, never into the JSON protocol parser.
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk)
      // Match across chunks; retain only a bounded window of diagnostics.
      stderrTail = (stderrTail + chunk).slice(-16384)
      if (!sandboxDiagnostic && /sandbox uses bubblewrap and needs access to create user namespaces/i.test(stderrTail)) {
        sandboxDiagnostic = 'The Linux sandbox cannot create user namespaces. Ensure bubblewrap is installed and allowed by the host policy. On Ubuntu 24.04, install apparmor-profiles and apparmor-utils, then load the bwrap-userns-restrict AppArmor profile.'
        onDiagnostic?.(sandboxDiagnostic)
      }
    })
    lines = readline.createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      if (!line.trim()) return
      try {
        const message = JSON.parse(line)
        if (message.method && message.id != null) {
          Promise.resolve(onRequest(message)).then(
            (result) => { if (result !== undefined && !failure && !closing) write({ id: message.id, result }) },
            (err) => { if (!failure && !closing) write({ id: message.id, error: { code: -32603, message: err.message } }) },
          ).catch(fail)
        } else if (message.method) {
          onNotification(message.method, message.params || {})
        } else if (message.id != null) {
          const entry = pending.get(message.id)
          if (!entry) return
          pending.delete(message.id)
          clearTimeout(entry.timer)
          if (message.error) entry.reject(withDiagnostics(new Error(message.error.message || JSON.stringify(message.error))))
          else entry.resolve(message.result)
        }
      } catch (err) {
        fail(new Error(`Codex protocol error: ${err.message}`))
      }
    })
    await request('initialize', {
      clientInfo: { name: 'local_harness', title: 'Harness', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    })
    write({ method: 'initialized', params: {} })
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
    fail(new Error('Codex connection closed'))
    if (!child) return
    child.stdin.destroy()
    kill('SIGTERM')
    const timer = setTimeout(() => kill('SIGKILL'), 2000)
    try { await exited } finally { clearTimeout(timer); lines?.close() }
  }

  return { start, request, close }
}

module.exports = { createTransport }
