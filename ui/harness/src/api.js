const fail = async (res) => {
  let body = null
  try {
    body = await res.json()
  } catch {
    // ignore
  }
  const error = new Error((body && body.error) || res.statusText || `HTTP ${res.status}`)
  error.status = res.status
  error.body = body
  if (body && body.mtime !== undefined) error.mtime = body.mtime
  throw error
}

const json = async (res) => {
  if (!res.ok) return fail(res)
  return res.json()
}

const empty = async (res) => {
  if (!res.ok) return fail(res)
  return null
}

const send = (method, url, body) =>
  fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  })

const post = (url, body) => send('POST', url, body).then(json)

// Multi-machine: ids from a remote machine carry an `@<machine>` suffix and
// their requests go through nginx at /m/<machine>/. No machines = local only.
let machinesRequest = null
const loadMachines = () => {
  if (!machinesRequest) {
    machinesRequest = fetch(at(null, '/machines.json'), { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : {}))
      .catch(() => ({}))
      .then((data) => ({
        self: data.self || null,
        machines: Array.isArray(data.machines) ? data.machines : [],
      }))
  }
  return machinesRequest
}

const splitId = (value) => {
  if (typeof value !== 'string') return { id: value, machine: null }
  const at = value.lastIndexOf('@')
  if (at < 0) return { id: value, machine: null }
  return { id: value.slice(0, at), machine: value.slice(at + 1) }
}

const tagId = (id, machine) => (machine && id ? `${id}@${machine}` : id)

// Vite's base, so the app also works behind a path prefix such as /harness/.
const base = import.meta.env.BASE_URL.replace(/\/$/, '')

const at = (machine, path) => `${base}${machine ? `/m/${encodeURIComponent(machine)}` : ''}${path}`

const tagWorkspace = (workspace, machine) => (machine && workspace ? {
  ...workspace,
  id: tagId(workspace.id, machine),
  name: `${workspace.name}@${machine}`,
  machine,
} : workspace)

const tagSession = (session, machine) => (machine && session ? {
  ...session,
  id: tagId(session.id, machine),
  workspaceId: tagId(session.workspaceId, machine),
  sourceSessionId: tagId(session.sourceSessionId, machine),
  machine,
} : session)

const tagTerminal = (terminal, machine) => (machine && terminal ? {
  ...terminal,
  id: tagId(terminal.id, machine),
  workspaceId: tagId(terminal.workspaceId, machine),
  groupId: tagId(terminal.groupId, machine),
  machine,
} : terminal)

const tagGroup = (group, machine) => (machine && group ? {
  ...group,
  id: tagId(group.id, machine),
  workspaceId: tagId(group.workspaceId, machine),
  machine,
} : group)

// Runs `fn(machine)` on every machine; unreachable machines are skipped.
const eachMachine = async (fn) => {
  const { machines } = await loadMachines()
  if (!machines.length) return [await fn(null)]
  const results = await Promise.allSettled(machines.map(fn))
  const ok = results.filter((result) => result.status === 'fulfilled').map((result) => result.value)
  if (!ok.length) throw results[0].reason
  return ok
}

const fsQuery = (workspace, params) => {
  const query = new URLSearchParams()
  if (workspace) query.set('workspace', workspace)
  Object.entries(params).forEach(([key, value]) => query.set(key, value ?? ''))
  return query
}

const fsBody = (workspace, body) => (workspace ? { workspace, ...body } : body)

// Splits a tagged workspace id into the machine and the request query/body.
const fsTarget = (workspace) => {
  const { id, machine } = splitId(workspace)
  return {
    machine,
    query: (params) => fsQuery(id, params),
    body: (body) => fsBody(id, body),
  }
}

const sessionUrl = (sessionId, suffix = '') => {
  const { id, machine } = splitId(sessionId)
  return { machine, url: at(machine, `/api/sessions/${encodeURIComponent(id)}${suffix}`) }
}

const patchSession = (sessionId, body) => {
  const { machine, url } = sessionUrl(sessionId)
  return send('PATCH', url, body).then(json).then((data) => ({ ...data, session: tagSession(data.session, machine) }))
}

const sessionPost = (sessionId, suffix, body) => {
  const { machine, url } = sessionUrl(sessionId, suffix)
  return post(url, body).then((data) => (data && data.session ? { ...data, session: tagSession(data.session, machine) } : data))
}

const sortSessions = (sessions, { orderBy = 'createdAt', order = 'desc', limit } = {}) => {
  const sign = order === 'asc' ? 1 : -1
  const sorted = [...sessions].sort((a, b) => sign * ((a[orderBy] || 0) - (b[orderBy] || 0)))
  return limit === undefined ? sorted : sorted.slice(0, limit)
}

const listTerminalItems = async (kind, key, tag, workspace, { all = false } = {}) => {
  if (!all) {
    const target = fsTarget(workspace)
    const data = await fetch(at(target.machine, `/api/terminal${kind}?${target.query({})}`)).then(json)
    return { ...data, [key]: data[key].map((item) => tag(item, target.machine)) }
  }
  const lists = await eachMachine(async (machine) => {
    const data = await fetch(at(machine, `/api/terminal${kind}?all=1`)).then(json)
    return data[key].map((item) => tag(item, machine))
  })
  return { [key]: lists.flat() }
}

const api = {
  loadMachines,
  machineOf: (id) => splitId(id).machine,
  // Tags a record streamed from `sessionId`'s machine (SSE payloads).
  adoptSession: (sessionId, session) => tagSession(session, splitId(sessionId).machine),
  getProviders: () => fetch(at(null, '/api/providers')).then(json),
  getUiSettings: () => fetch(at(null, '/api/ui')).then(json),
  setUiSettings: (patch) => send('PATCH', at(null, '/api/ui'), patch).then(json),
  listWorkDir: (path, machine = null) =>
    fetch(at(machine, `/api/workdir${path ? `?path=${encodeURIComponent(path)}` : ''}`)).then(json),
  listWorkspaces: async () => {
    const lists = await eachMachine(async (machine) => {
      const { workspaces } = await fetch(at(machine, '/api/workspaces')).then(json)
      return workspaces.map((workspace) => tagWorkspace(workspace, machine))
    })
    return { workspaces: lists.flat() }
  },
  createWorkspace: ({ machine = null, ...payload }) =>
    post(at(machine, '/api/workspaces'), payload)
      .then((data) => ({ ...data, workspace: tagWorkspace(data.workspace, machine) })),
  updateWorkspace: (workspaceId, { name, cwd }) => {
    const { id, machine } = splitId(workspaceId)
    return send('PATCH', at(machine, `/api/workspaces/${encodeURIComponent(id)}`), { name, cwd })
      .then(json)
      .then((data) => ({ ...data, workspace: tagWorkspace(data.workspace, machine) }))
  },
  setWorkspaceDeleted: (workspaceId, deleted) => {
    const { id, machine } = splitId(workspaceId)
    return send('PATCH', at(machine, `/api/workspaces/${encodeURIComponent(id)}`), { deleted })
      .then(json)
      .then((data) => ({ ...data, workspace: tagWorkspace(data.workspace, machine) }))
  },
  // Allowed modes and panels; global scope when there is no workspace.
  getRegistry: (workspaceId) => {
    if (!workspaceId) return fetch(at(null, '/api/registry')).then(json)
    const { id, machine } = splitId(workspaceId)
    return fetch(at(machine, `/api/workspaces/${encodeURIComponent(id)}/registry`)).then(json)
  },
  // Built-in prompt templates with the vars each one interpolates.
  listPrompts: ({ signal } = {}) => fetch(at(null, '/api/prompts'), { signal }).then(json),

  // Every registry entry with its decision; global scope when there is no workspace.
  explainRegistry: (workspaceId, { provider } = {}, { signal } = {}) => {
    const query = provider ? `?${new URLSearchParams({ provider })}` : ''
    if (!workspaceId) return fetch(at(null, `/api/registry/explain${query}`), { signal }).then(json)
    const { id, machine } = splitId(workspaceId)
    return fetch(at(machine, `/api/workspaces/${encodeURIComponent(id)}/registry/explain${query}`), { signal }).then(json)
  },
  listSessions: async (workspaceId, includeArchived = false, { orderBy, order, limit, active } = {}) => {
    const query = new URLSearchParams({ includeArchived: String(includeArchived) })
    if (orderBy !== undefined) query.set('orderBy', orderBy)
    if (order !== undefined) query.set('order', order)
    if (limit !== undefined) query.set('limit', String(limit))
    if (active !== undefined) query.set('active', String(active))
    if (workspaceId) {
      const { id, machine } = splitId(workspaceId)
      const data = await fetch(at(machine, `/api/workspaces/${encodeURIComponent(id)}/sessions?${query}`)).then(json)
      return { ...data, sessions: data.sessions.map((session) => tagSession(session, machine)) }
    }
    const lists = await eachMachine(async (machine) => {
      const { sessions } = await fetch(at(machine, `/api/sessions?${query}`)).then(json)
      return sessions.map((session) => tagSession(session, machine))
    })
    if (lists.length === 1) return { sessions: lists[0] }
    return { sessions: sortSessions(lists.flat(), { orderBy, order, limit }) }
  },
  createSession: ({ workspaceId, ...payload }) => {
    const { id, machine } = splitId(workspaceId)
    return post(at(machine, `/api/workspaces/${encodeURIComponent(id)}/sessions`), payload)
      .then((data) => ({ ...data, session: tagSession(data.session, machine) }))
  },
  setSessionArchived: (id, archived) => patchSession(id, { archived }),
  setSessionName: (id, name) => patchSession(id, { name }),
  setSessionPinned: (id, pinned) => patchSession(id, { pinned }),
  getSession: (id) => {
    const { machine, url } = sessionUrl(id)
    return fetch(url).then(json).then((data) => ({ ...data, session: tagSession(data.session, machine) }))
  },
  plan: (id, prompt) => sessionPost(id, '/plan', { prompt }),
  run: (id, { prompt, mode, provider, model }) => sessionPost(id, '/run', { prompt, mode, provider, model }),
  decompose: (id, prompt) => sessionPost(id, '/decompose', { prompt }),
  resume: (id, { prompt, mode } = {}) => sessionPost(id, '/resume', { prompt, mode }),
  pause: (id) => sessionPost(id, '/pause'),
  stop: (id) => sessionPost(id, '/stop'),
  steer: (id, prompt) => sessionPost(id, '/steer', { prompt }),
  answerQuestion: (id, qid, answer) => sessionPost(id, `/questions/${qid}/answer`, { answer }),
  getLog: (id, { signal } = {}) =>
    fetch(sessionUrl(id, '/log').url, { signal }).then((res) => res.ok ? res.text() : json(res)),
  eventsUrl: (id) => sessionUrl(id, '/events').url,
  getToolStats: (params = {}, { signal } = {}) => {
    const query = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
    })
    return fetch(at(null, `/api/analytics/tool-calls?${query}`), { signal }).then(json)
  },
  listMemories: (params = {}, { signal } = {}) => {
    const query = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
    })
    return fetch(at(null, `/api/memory/memories?${query}`), { signal }).then(json)
  },
  getMemory: (id) => fetch(at(null, `/api/memory/memories/${encodeURIComponent(id)}`)).then(json),
  createMemory: (memory) => post(at(null, '/api/memory/memories'), memory),
  updateMemory: (id, patch) => send('PATCH', at(null, `/api/memory/memories/${encodeURIComponent(id)}`), patch).then(json),
  deleteMemory: (id) => fetch(at(null, `/api/memory/memories/${encodeURIComponent(id)}`), { method: 'DELETE' }).then(empty),
  getCodeStats: (workspace, { signal } = {}) => {
    const target = fsTarget(workspace)
    return fetch(at(target.machine, `/api/analytics/code-stats?${target.query({})}`), { signal }).then(json)
  },
  fsSearch: (workspace, query, { signal } = {}) => {
    const target = fsTarget(workspace)
    return fetch(at(target.machine, `/api/editor/search?${target.query({ q: query })}`), { signal }).then(json)
  },
  fsList: (workspace, path = '') => {
    const target = fsTarget(workspace)
    return fetch(at(target.machine, `/api/editor/list?${target.query({ path })}`)).then(json)
  },
  fsRead: (workspace, path) => {
    const target = fsTarget(workspace)
    return fetch(at(target.machine, `/api/editor/file?${target.query({ path })}`)).then(json)
  },
  fsRawUrl: (workspace, path) => {
    const target = fsTarget(workspace)
    return at(target.machine, `/api/editor/raw?${target.query({ path })}`)
  },
  fsWrite: (workspace, path, content, mtime) => {
    const target = fsTarget(workspace)
    return send('PUT', at(target.machine, '/api/editor/file'),
      target.body(mtime == null ? { path, content } : { path, content, mtime })).then(json)
  },
  fsCreateFile: (workspace, path) => {
    const target = fsTarget(workspace)
    return post(at(target.machine, '/api/editor/file'), target.body({ path }))
  },
  fsCreateDir: (workspace, path) => {
    const target = fsTarget(workspace)
    return post(at(target.machine, '/api/editor/dir'), target.body({ path }))
  },
  fsRename: (workspace, from, to) => {
    const target = fsTarget(workspace)
    return post(at(target.machine, '/api/editor/rename'), target.body({ from, to }))
  },
  fsDelete: (workspace, path) => {
    const target = fsTarget(workspace)
    return fetch(at(target.machine, `/api/editor?${target.query({ path })}`), { method: 'DELETE' }).then(empty)
  },
  listTerminals: (workspace, options) => listTerminalItems('', 'terminals', tagTerminal, workspace, options),
  listTerminalGroups: (workspace, options) => listTerminalItems('/groups', 'groups', tagGroup, workspace, options),
  createTerminalGroup: (workspace, { name } = {}) => {
    const target = fsTarget(workspace)
    return post(at(target.machine, '/api/terminal/groups'), target.body(name ? { name } : {}))
      .then((data) => ({ ...data, group: tagGroup(data.group, target.machine) }))
  },
  createTerminal: (workspace, { cols, rows, groupId } = {}) => {
    const target = fsTarget(workspace)
    const group = splitId(groupId).id
    return post(at(target.machine, '/api/terminal'), target.body(group ? { cols, rows, groupId: group } : { cols, rows }))
      .then((data) => ({ ...data, terminal: tagTerminal(data.terminal, target.machine) }))
  },
  renameTerminal: (terminalId, name) => {
    const { id, machine } = splitId(terminalId)
    return send('PATCH', at(machine, `/api/terminal/${encodeURIComponent(id)}`), { name })
      .then(json)
      .then((data) => ({ ...data, terminal: tagTerminal(data.terminal, machine) }))
  },
  setTerminalGroup: (terminalId, groupId) => {
    const { id, machine } = splitId(terminalId)
    const group = groupId ? splitId(groupId).id : groupId
    return send('PATCH', at(machine, `/api/terminal/${encodeURIComponent(id)}`), { groupId: group })
      .then(json)
      .then((data) => ({ ...data, terminal: tagTerminal(data.terminal, machine) }))
  },
  killTerminal: (terminalId) => {
    const { id, machine } = splitId(terminalId)
    return fetch(at(machine, `/api/terminal/${encodeURIComponent(id)}`), { method: 'DELETE' }).then(empty)
  },
  getTerminalStartup: () => fetch(at(null, '/api/terminal/startup'), { cache: 'no-store' }).then(json),
  saveTerminalStartup: (text) => send('PUT', at(null, '/api/terminal/startup'), { text }).then(json),
  gitStatus: (workspace, { signal } = {}) => {
    const target = fsTarget(workspace)
    return fetch(at(target.machine, `/api/git/status?${target.query({})}`), { signal }).then(json)
  },
  gitBranches: (workspace) => {
    const target = fsTarget(workspace)
    return fetch(at(target.machine, `/api/git/branches?${target.query({})}`)).then(json)
  },
  gitLog: (workspace, limit = 30) => {
    const target = fsTarget(workspace)
    return fetch(at(target.machine, `/api/git/log?${target.query({ limit })}`)).then(json)
  },
  gitDiff: (workspace, { path, origPath, staged }, { signal } = {}) => {
    const target = fsTarget(workspace)
    const query = target.query({ path, origPath: origPath || '', staged: staged ? '1' : '' })
    return fetch(at(target.machine, `/api/git/diff?${query}`), { signal }).then(json)
  },
  gitCheckout: (workspace, branch, { create = false, startPoint } = {}) => {
    const target = fsTarget(workspace)
    return post(at(target.machine, '/api/git/checkout'),
      target.body(startPoint ? { branch, create, startPoint } : { branch, create }))
  },
  gitStage: (workspace, paths) => {
    const target = fsTarget(workspace)
    return post(at(target.machine, '/api/git/stage'), target.body({ paths }))
  },
  gitUnstage: (workspace, paths) => {
    const target = fsTarget(workspace)
    return post(at(target.machine, '/api/git/unstage'), target.body({ paths }))
  },
  gitDiscard: (workspace, paths) => {
    const target = fsTarget(workspace)
    return post(at(target.machine, '/api/git/discard'), target.body({ paths }))
  },
  gitCommit: (workspace, { message, amend = false }) => {
    const target = fsTarget(workspace)
    return post(at(target.machine, '/api/git/commit'), target.body({ message, amend }))
  },
  gitPush: (workspace, { force = false } = {}) => {
    const target = fsTarget(workspace)
    return post(at(target.machine, '/api/git/push'), target.body({ force }))
  },
  gitPull: (workspace) => {
    const target = fsTarget(workspace)
    return post(at(target.machine, '/api/git/pull'), target.body({}))
  },
  gitFetch: (workspace) => {
    const target = fsTarget(workspace)
    return post(at(target.machine, '/api/git/fetch'), target.body({}))
  },
  terminalSocketUrl: (terminalId) => {
    const { id, machine } = splitId(terminalId)
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${location.host}${at(machine, `/api/terminal/${encodeURIComponent(id)}/socket`)}`
  },
}

export default api
