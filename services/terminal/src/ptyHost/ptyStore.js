const crypto = require('crypto')
const pty = require('node-pty')

const SCROLLBACK_LIMIT = 1024 * 1024
const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

const clampSize = (value, fallback) => {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n < 2) return fallback
  return Math.min(n, 1000)
}

// The service's own launch env (its PORT/HOST, make and npm state) must not leak into user shells.
const SERVICE_ENV_KEYS = new Set([
  'PORT', 'HOST', 'NODE_ENV', 'INIT_CWD',
  'MAKELEVEL', 'MAKEFLAGS', 'MFLAGS', 'MAKEOVERRIDES', 'MAKE_TERMOUT', 'MAKE_TERMERR',
])

const shellEnv = () => {
  const env = Object.create(null)
  Object.entries(process.env).forEach(([key, value]) => {
    if (SERVICE_ENV_KEYS.has(key) || key.startsWith('npm_')) return
    env[key] = value
  })
  env.TERM = 'xterm-256color'
  return env
}

const createScrollback = () => {
  const data = Object.create(null)
  data.chunks = []
  data.length = 0

  const append = (chunk) => {
    data.chunks.push(chunk)
    data.length += chunk.length
    while (data.length > SCROLLBACK_LIMIT && data.chunks.length > 1) {
      data.length -= data.chunks.shift().length
    }
    if (data.length > SCROLLBACK_LIMIT) {
      data.chunks[0] = data.chunks[0].slice(data.length - SCROLLBACK_LIMIT)
      data.length = SCROLLBACK_LIMIT
    }
  }

  const toString = () => {
    if (data.chunks.length > 1) data.chunks = [data.chunks.join('')]
    return data.chunks[0] || ''
  }

  return { append, toString }
}

const notFound = () => Object.assign(new Error('Terminal not found'), { code: 'not_found' })

// Owns the shells. Exited entries stay until an explicit kill so the exit
// status survives an API restart.
const createPtyStore = ({ onOutput, onExit }) => {
  const data = Object.create(null)
  data.terminals = new Map()

  const summary = (entry) => ({
    id: entry.id,
    workspaceId: entry.workspaceId,
    cwd: entry.cwd,
    cols: entry.cols,
    rows: entry.rows,
    exited: entry.exited,
    exitCode: entry.exitCode,
    createdAt: entry.createdAt,
  })

  const find = (id) => {
    const entry = data.terminals.get(id)
    if (!entry) throw notFound()
    return entry
  }

  const create = ({ workspaceId, cwd, cols, rows } = {}) => {
    const size = { cols: clampSize(cols, DEFAULT_COLS), rows: clampSize(rows, DEFAULT_ROWS) }
    const shell = process.env.SHELL || '/bin/sh'
    const proc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: size.cols,
      rows: size.rows,
      cwd,
      env: shellEnv(),
    })
    const entry = {
      id: crypto.randomUUID(),
      workspaceId: workspaceId == null ? null : String(workspaceId),
      cwd,
      pty: proc,
      scrollback: createScrollback(),
      exited: false,
      exitCode: null,
      createdAt: Date.now(),
      ...size,
    }
    proc.onData((chunk) => {
      if (data.terminals.get(entry.id) !== entry) return
      entry.scrollback.append(chunk)
      onOutput(entry.id, chunk)
    })
    proc.onExit(({ exitCode }) => {
      entry.exited = true
      entry.exitCode = exitCode
      if (data.terminals.get(entry.id) === entry) onExit(entry.id, exitCode)
    })
    data.terminals.set(entry.id, entry)
    return summary(entry)
  }

  const list = () =>
    Array.from(data.terminals.values())
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(summary)

  const snapshot = (id) => {
    const entry = find(id)
    return { data: entry.scrollback.toString(), exited: entry.exited, exitCode: entry.exitCode }
  }

  const write = (id, chunk) => {
    const entry = find(id)
    if (entry.exited || typeof chunk !== 'string') return
    entry.pty.write(chunk)
  }

  const resize = (id, cols, rows) => {
    const entry = find(id)
    const nextCols = clampSize(cols, entry.cols)
    const nextRows = clampSize(rows, entry.rows)
    if (entry.exited || (nextCols === entry.cols && nextRows === entry.rows)) {
      return { cols: entry.cols, rows: entry.rows }
    }
    entry.cols = nextCols
    entry.rows = nextRows
    try {
      entry.pty.resize(nextCols, nextRows)
    } catch {
      // The pty can close between the exit check and the resize.
    }
    return { cols: entry.cols, rows: entry.rows }
  }

  const kill = (id, signal) => {
    const entry = find(id)
    data.terminals.delete(id)
    if (!entry.exited) {
      try {
        entry.pty.kill(signal)
      } catch {
        // Already gone.
      }
    }
  }

  const killAll = () => {
    Array.from(data.terminals.keys()).forEach((id) => kill(id, 'SIGKILL'))
  }

  return { create, list, snapshot, write, resize, kill, killAll }
}

module.exports = { createPtyStore, shellEnv, SERVICE_ENV_KEYS, createScrollback, clampSize }
