const { resolveRoot, findWorkspaceId } = require('./workspaceRoot')
const paths = require('./paths')
const startup = require('./startup')
const { readJson, writeJson } = require('./jsonFile')
const { requestTerminalName } = require('../categorizer')
const hostClient = require('../hostClient')

const MAX_NAME = 100
const MAX_GROUP = 64
const MAX_COMMAND = 1000
const SOCKET_OPEN = 1
const CLOSE_GOING_AWAY = 1001
const CLOSE_UNAVAILABLE = 1011
const CLOSE_NOT_FOUND = 4404
const PASTE_MARKER = /\x1b\[20[01]~/g
const TRIVIAL_COMMAND = /^(cd|ls|ll|la|l|pwd|clear|reset|exit|history)(\s|$)/
const COMMAND_CHAIN = /[;&|]/
const DEFAULT_NAME = /^Terminal (\d+)$/

const httpError = (httpStatus, message) => Object.assign(new Error(message), { httpStatus })

const workspaceKey = (workspace) =>
  workspace === undefined || workspace === null || workspace === '' ? null : String(workspace)

const send = (socket, message) => {
  if (socket.readyState === SOCKET_OPEN) socket.send(JSON.stringify(message))
}

// Maps pty host failures onto HTTP errors.
const hostRequest = async (type, payload) => {
  try {
    return await hostClient.request(type, payload)
  } catch (err) {
    if (err && err.code === 'not_found') throw httpError(404, 'Terminal not found')
    throw httpError(503, err && err.message ? err.message : 'pty host unavailable')
  }
}

// Rebuilds the line typed at the prompt from raw input. Any control key the
// shell handles itself (history, completion, cursor movement) makes the line
// unknowable until the next submit.
const createInputLine = () => {
  const data = Object.create(null)
  data.text = ''
  data.known = true

  const reset = () => {
    data.text = ''
    data.known = true
  }

  const feed = (chunk) => {
    const submitted = []
    for (const char of chunk.replace(PASTE_MARKER, '')) {
      if (char === '\r' || char === '\n') {
        const line = data.text.trim()
        if (data.known && line) submitted.push(line)
        reset()
      } else if (char === '\x03' || char === '\x15') {
        reset()
      } else if (char === '\x7f' || char === '\b') {
        data.text = data.text.slice(0, -1)
      } else if (char < ' ') {
        data.known = false
      } else if (data.text.length < MAX_COMMAND) {
        data.text += char
      }
    }
    return submitted
  }

  return { feed }
}

const isNameable = (command) => !TRIVIAL_COMMAND.test(command) || COMMAND_CHAIN.test(command)

const createTerminalStore = () => {
  const data = Object.create(null)
  data.terminals = new Map()
  data.counters = new Map()
  data.stopping = false
  data.ready = false
  data.startupRun = Promise.resolve([])

  const nextName = (workspaceId) => {
    const key = workspaceId || ''
    const n = (data.counters.get(key) || 0) + 1
    data.counters.set(key, n)
    return `Terminal ${n}`
  }

  const normalizeGroupId = (value) => {
    if (value == null || value === '') return null
    if (typeof value !== 'string') throw httpError(400, 'groupId must be a string')
    const next = value.trim().slice(0, MAX_GROUP)
    return next || null
  }

  const readMeta = (entry) => {
    const meta = readJson(paths.terminalMetaFile(entry.id), null)
    if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
      if (typeof meta.name === 'string') {
        const name = meta.name.trim().slice(0, MAX_NAME)
        if (name) entry.name = name
      }
      entry.nameSource = meta.nameSource === 'manual' || meta.nameSource === 'auto' ? meta.nameSource : null
      if (typeof meta.groupId === 'string') {
        const groupId = meta.groupId.trim().slice(0, MAX_GROUP)
        entry.groupId = groupId || null
      } else {
        entry.groupId = null
      }
      entry.startup = typeof meta.startup === 'string' && meta.startup ? meta.startup : null
    }
    return entry
  }

  const writeMeta = (id, patch) => {
    const file = paths.terminalMetaFile(id)
    const current = readJson(file, {})
    const meta = current && typeof current === 'object' && !Array.isArray(current) ? current : {}
    const next = { ...meta, ...patch }
    if (next.groupId == null) delete next.groupId
    writeJson(file, next)
  }

  const toJSON = (entry) => {
    readMeta(entry)
    return {
      id: entry.id,
      workspaceId: entry.workspaceId,
      cwd: entry.cwd,
      name: entry.name,
      groupId: entry.groupId || null,
      cols: entry.cols,
      rows: entry.rows,
      clients: entry.clients.size,
      exited: entry.exited,
      exitCode: entry.exitCode,
      createdAt: entry.createdAt,
    }
  }

  const find = (id) => {
    const entry = data.terminals.get(id)
    if (!entry) throw httpError(404, 'Terminal not found')
    return entry
  }

  const broadcast = (entry, message) => {
    entry.clients.forEach((socket) => send(socket, message))
  }

  const fromHost = (summary) => ({
    id: summary.id,
    workspaceId: workspaceKey(summary.workspaceId),
    cwd: summary.cwd,
    name: null,
    nameSource: null,
    nameRequested: false,
    groupId: null,
    startup: null,
    input: createInputLine(),
    clients: new Set(),
    exited: summary.exited === true,
    exitCode: summary.exitCode == null ? null : summary.exitCode,
    createdAt: summary.createdAt,
    cols: summary.cols,
    rows: summary.rows,
  })

  const create = async ({ workspace, cols, rows, groupId, name, startup: startupKey, command } = {}) => {
    const workspaceId = workspaceKey(workspace)
    const cwd = await resolveRoot(workspace)
    const group = normalizeGroupId(groupId)
    const manualName = typeof name === 'string' ? name.trim().slice(0, MAX_NAME) : ''
    if (data.stopping) throw httpError(503, 'Terminal service is shutting down')
    const entry = fromHost(await hostRequest('create', { workspaceId, cwd, cols, rows }))
    entry.name = manualName || nextName(workspaceId)
    entry.nameSource = manualName ? 'manual' : null
    entry.nameRequested = Boolean(manualName)
    entry.groupId = group
    entry.startup = typeof startupKey === 'string' && startupKey ? startupKey : null
    try {
      const meta = { name: entry.name, groupId: entry.groupId }
      if (manualName) meta.nameSource = 'manual'
      if (entry.startup) meta.startup = entry.startup
      writeMeta(entry.id, meta)
    } catch (err) {
      hostClient.request('kill', { id: entry.id }).catch(() => {})
      throw err
    }
    data.terminals.set(entry.id, entry)
    const lines = typeof command === 'string' ? command.split(/\r?\n/).filter((line) => line.trim()) : []
    for (const line of lines) {
      await hostRequest('write', { id: entry.id, data: `${line}\r` })
    }
    return toJSON(entry)
  }

  const startupKeyOf = (workspaceId, name) => `${workspaceId}/${name}`

  // Creates every startup terminal that is not already running. Runs are
  // serialized so overlapping calls cannot start the same terminal twice.
  const runStartup = () => {
    const run = async () => {
      if (data.stopping) return []
      const live = new Set(Array.from(data.terminals.values())
        .filter((entry) => entry.startup && !entry.exited)
        .map((entry) => entry.startup))
      const created = []
      for (const item of startup.parse(startup.read())) {
        try {
          const workspaceId = findWorkspaceId(item.workspace)
          if (!workspaceId) {
            console.warn(`terminal startup: unknown workspace "${item.workspace}"`)
            continue
          }
          const key = startupKeyOf(workspaceId, item.name)
          if (live.has(key)) continue
          live.add(key)
          created.push(await create({ workspace: workspaceId, name: item.name, startup: key, command: item.command }))
        } catch (err) {
          console.error(`terminal startup "${item.workspace}/${item.name}" failed: ${err.message}`)
        }
      }
      return created
    }
    const next = data.startupRun.catch(() => []).then(run)
    data.startupRun = next
    return next
  }

  const list = (workspace, options = {}) => {
    const all = options.all === true
    const workspaceId = workspaceKey(workspace)
    return Array.from(data.terminals.values())
      .filter((entry) => all || entry.workspaceId === workspaceId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(toJSON)
  }

  const rename = (id, name) => {
    if (typeof name !== 'string') throw httpError(400, 'name must be a string')
    const next = name.trim().slice(0, MAX_NAME)
    if (!next) throw httpError(400, 'name is required')
    const entry = find(id)
    writeMeta(entry.id, { name: next, nameSource: 'manual' })
    entry.name = next
    entry.nameSource = 'manual'
    return toJSON(entry)
  }

  // Categorizer callback. Never overrides a manual rename.
  const autoName = (id, name) => {
    if (typeof name !== 'string') throw httpError(400, 'result must be a string')
    const next = name.trim().slice(0, MAX_NAME)
    if (!next) throw httpError(400, 'result is empty')
    const entry = find(id)
    readMeta(entry)
    if (entry.nameSource === 'manual') return { terminal: toJSON(entry), applied: false }
    writeMeta(entry.id, { name: next, nameSource: 'auto' })
    entry.name = next
    entry.nameSource = 'auto'
    broadcast(entry, { type: 'name', name: next })
    return { terminal: toJSON(entry), applied: true }
  }

  // Names the terminal once, from the first command that says something about it.
  const watchCommands = (entry, chunk) => {
    if (entry.nameRequested) return
    const command = entry.input.feed(chunk).find(isNameable)
    if (!command) return
    entry.nameRequested = true
    if (entry.nameSource === 'manual') return
    requestTerminalName(entry.id, command)
  }

  const setGroup = (id, groupId) => {
    const next = normalizeGroupId(groupId)
    const entry = find(id)
    writeMeta(entry.id, { groupId: next })
    entry.groupId = next
    return toJSON(entry)
  }

  const kill = async (id) => {
    const entry = find(id)
    data.terminals.delete(id)
    entry.clients.forEach((socket) => socket.close(1000, 'Terminal closed'))
    entry.clients.clear()
    await hostRequest('kill', { id }).catch((err) => {
      if (err.httpStatus !== 404) throw err
    })
  }

  const handleMessage = (entry, raw) => {
    let message
    try {
      message = JSON.parse(String(raw))
    } catch {
      return
    }
    if (!message || entry.exited) return
    if (message.type === 'input' && typeof message.data === 'string') {
      hostClient.request('write', { id: entry.id, data: message.data }).catch(() => {})
      watchCommands(entry, message.data)
    } else if (message.type === 'resize') {
      hostClient.request('resize', { id: entry.id, cols: message.cols, rows: message.rows })
        .then((size) => {
          entry.cols = size.cols
          entry.rows = size.rows
        })
        .catch(() => {})
    }
  }

  // The host stream is ordered: output events before the snapshot reply are in
  // the snapshot, and events after it reach the socket once it is added.
  const attach = (id, socket) => {
    const entry = data.terminals.get(id)
    if (!entry) {
      socket.close(CLOSE_NOT_FOUND, 'Terminal not found')
      return
    }
    const state = Object.create(null)
    state.open = true
    const detach = () => {
      state.open = false
      entry.clients.delete(socket)
    }
    socket.on('message', (raw) => handleMessage(entry, raw))
    socket.on('close', detach)
    socket.on('error', detach)
    hostClient.request('snapshot', { id }).then((snapshot) => {
      if (!state.open) return
      if (data.terminals.get(id) !== entry) {
        socket.close(CLOSE_NOT_FOUND, 'Terminal not found')
        return
      }
      entry.exited = snapshot.exited
      entry.exitCode = snapshot.exitCode
      send(socket, { type: 'output', data: snapshot.data })
      if (entry.exited) send(socket, { type: 'exit', code: entry.exitCode })
      entry.clients.add(socket)
    }).catch((err) => {
      if (!state.open) return
      if (err && err.code === 'not_found') {
        data.terminals.delete(id)
        socket.close(CLOSE_NOT_FOUND, 'Terminal not found')
      } else {
        socket.close(CLOSE_UNAVAILABLE, 'pty host unavailable')
      }
    })
  }

  const handleHostEvent = (message) => {
    const entry = data.terminals.get(message.id)
    if (!entry) return
    if (message.type === 'output' && typeof message.data === 'string') {
      broadcast(entry, { type: 'output', data: message.data })
    } else if (message.type === 'exit') {
      entry.exited = true
      entry.exitCode = message.code == null ? null : message.code
      broadcast(entry, { type: 'exit', code: entry.exitCode })
    }
  }

  // The host's shells are gone (or unreachable), so every attached view is stale.
  const handleHostDisconnect = () => {
    const entries = Array.from(data.terminals.values())
    data.terminals.clear()
    entries.forEach((entry) => {
      entry.clients.forEach((socket) => socket.close(CLOSE_NOT_FOUND, 'Terminal host restarted'))
      entry.clients.clear()
    })
  }

  // Rebuilds the map from the host's shells and their saved metadata.
  const sync = async () => {
    const summaries = await hostClient.request('list')
    const entries = summaries.map((summary) => readMeta(fromHost(summary)))
    // Already-named terminals are not sent to the categorizer again.
    entries.forEach((entry) => { entry.nameRequested = entry.nameSource !== null })
    data.counters.clear()
    entries.forEach((entry) => {
      const match = entry.name && DEFAULT_NAME.exec(entry.name)
      if (!match) return
      const key = entry.workspaceId || ''
      data.counters.set(key, Math.max(data.counters.get(key) || 0, Number(match[1])))
    })
    entries.forEach((entry) => {
      if (entry.name) return
      entry.name = nextName(entry.workspaceId)
      writeMeta(entry.id, { name: entry.name, groupId: entry.groupId })
    })
    data.terminals = new Map(entries.map((entry) => [entry.id, entry]))
  }

  const init = async () => {
    hostClient.onEvent(handleHostEvent)
    hostClient.onDisconnect(handleHostDisconnect)
    hostClient.onConnect(() => {
      if (!data.ready || data.stopping) return
      sync()
        .then(() => runStartup())
        .catch((err) => console.error(`terminal sync failed: ${err.message}`))
    })
    await sync()
    data.ready = true
    await runStartup().catch((err) => console.error(`terminal startup failed: ${err.message}`))
  }

  // Leaves the shells running in the host; 1001 tells the UI to reconnect.
  const shutdown = () => {
    data.stopping = true
    data.terminals.forEach((entry) => {
      entry.clients.forEach((socket) => socket.close(CLOSE_GOING_AWAY, 'Terminal service restarting'))
      entry.clients.clear()
    })
    hostClient.close()
  }

  return { init, create, list, rename, autoName, setGroup, kill, attach, shutdown, runStartup }
}

module.exports = createTerminalStore()
module.exports.createTerminalStore = createTerminalStore
