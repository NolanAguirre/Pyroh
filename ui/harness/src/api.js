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

const fsQuery = (workspace, params) => {
  const query = new URLSearchParams()
  if (workspace) query.set('workspace', workspace)
  Object.entries(params).forEach(([key, value]) => query.set(key, value ?? ''))
  return query
}

const fsBody = (workspace, body) => (workspace ? { workspace, ...body } : body)

const api = {
  getProviders: () => fetch('/api/providers').then(json),
  getUiSettings: () => fetch('/api/ui').then(json),
  setUiSettings: (patch) => send('PATCH', '/api/ui', patch).then(json),
  listWorkDir: (path) =>
    fetch(`/api/workdir${path ? `?path=${encodeURIComponent(path)}` : ''}`).then(json),
  listWorkspaces: () => fetch('/api/workspaces').then(json),
  createWorkspace: (payload) => post('/api/workspaces', payload),
  setWorkspaceDeleted: (id, deleted) => fetch(`/api/workspaces/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deleted }),
  }).then(json),
  listModes: (workspaceId) => fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/modes`).then(json),
  listSessions: (workspaceId, includeArchived = false, { orderBy, order, limit, active } = {}) => {
    const query = new URLSearchParams({ includeArchived: String(includeArchived) })
    if (orderBy !== undefined) query.set('orderBy', orderBy)
    if (order !== undefined) query.set('order', order)
    if (limit !== undefined) query.set('limit', String(limit))
    if (active !== undefined) query.set('active', String(active))
    const path = workspaceId
      ? `/api/workspaces/${encodeURIComponent(workspaceId)}/sessions`
      : '/api/sessions'
    return fetch(`${path}?${query}`).then(json)
  },
  createSession: ({ workspaceId, ...payload }) =>
    post(`/api/workspaces/${encodeURIComponent(workspaceId)}/sessions`, payload),
  setSessionArchived: (id, archived) => fetch(`/api/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived }),
  }).then(json),
  setSessionName: (id, name) => fetch(`/api/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  }).then(json),
  setSessionPinned: (id, pinned) => fetch(`/api/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned }),
  }).then(json),
  getSession: (id) => fetch(`/api/sessions/${id}`).then(json),
  plan: (id, prompt) => post(`/api/sessions/${id}/plan`, { prompt }),
  run: (id, { prompt, mode, provider, model }) => post(`/api/sessions/${id}/run`, { prompt, mode, provider, model }),
  decompose: (id, prompt) => post(`/api/sessions/${id}/decompose`, { prompt }),
  resume: (id, { prompt, mode } = {}) => post(`/api/sessions/${id}/resume`, { prompt, mode }),
  pause: (id) => post(`/api/sessions/${id}/pause`),
  stop: (id) => post(`/api/sessions/${id}/stop`),
  steer: (id, prompt) => post(`/api/sessions/${id}/steer`, { prompt }),
  answerQuestion: (id, qid, answer) =>
    post(`/api/sessions/${id}/questions/${qid}/answer`, { answer }),
  getLog: (id, { signal } = {}) => fetch(`/api/sessions/${id}/log`, { signal }).then((res) => res.ok ? res.text() : json(res)),
  eventsUrl: (id) => `/api/sessions/${id}/events`,
  getToolStats: (params = {}, { signal } = {}) => {
    const query = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
    })
    return fetch(`/api/analytics/tool-calls?${query}`, { signal }).then(json)
  },
  getCodeStats: (workspace, { signal } = {}) =>
    fetch(`/api/analytics/code-stats?${fsQuery(workspace, {})}`, { signal }).then(json),
  fsSearch: (workspace, query, { signal } = {}) =>
    fetch(`/api/editor/search?${fsQuery(workspace, { q: query })}`, { signal }).then(json),
  fsList: (workspace, path = '') => fetch(`/api/editor/list?${fsQuery(workspace, { path })}`).then(json),
  fsRead: (workspace, path) => fetch(`/api/editor/file?${fsQuery(workspace, { path })}`).then(json),
  fsRawUrl: (workspace, path) => `/api/editor/raw?${fsQuery(workspace, { path })}`,
  fsWrite: (workspace, path, content, mtime) =>
    send('PUT', '/api/editor/file', fsBody(workspace, mtime == null ? { path, content } : { path, content, mtime })).then(json),
  fsCreateFile: (workspace, path) => post('/api/editor/file', fsBody(workspace, { path })),
  fsCreateDir: (workspace, path) => post('/api/editor/dir', fsBody(workspace, { path })),
  fsRename: (workspace, from, to) => post('/api/editor/rename', fsBody(workspace, { from, to })),
  fsDelete: (workspace, path) =>
    fetch(`/api/editor?${fsQuery(workspace, { path })}`, { method: 'DELETE' }).then(empty),
  listTerminals: (workspace, { all = false } = {}) =>
    fetch(`/api/terminal?${all ? 'all=1' : fsQuery(workspace, {})}`).then(json),
  listTerminalGroups: (workspace, { all = false } = {}) =>
    fetch(`/api/terminal/groups?${all ? 'all=1' : fsQuery(workspace, {})}`).then(json),
  createTerminalGroup: (workspace, { name } = {}) =>
    post('/api/terminal/groups', fsBody(workspace, name ? { name } : {})),
  createTerminal: (workspace, { cols, rows, groupId } = {}) =>
    post('/api/terminal', fsBody(workspace, groupId ? { cols, rows, groupId } : { cols, rows })),
  renameTerminal: (id, name) => send('PATCH', `/api/terminal/${encodeURIComponent(id)}`, { name }).then(json),
  setTerminalGroup: (id, groupId) =>
    send('PATCH', `/api/terminal/${encodeURIComponent(id)}`, { groupId }).then(json),
  killTerminal: (id) => fetch(`/api/terminal/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(empty),
  getTerminalStartup: () => fetch('/api/terminal/startup', { cache: 'no-store' }).then(json),
  saveTerminalStartup: (text) => send('PUT', '/api/terminal/startup', { text }).then(json),
  gitStatus: (workspace, { signal } = {}) => fetch(`/api/git/status?${fsQuery(workspace, {})}`, { signal }).then(json),
  gitBranches: (workspace) => fetch(`/api/git/branches?${fsQuery(workspace, {})}`).then(json),
  gitLog: (workspace, limit = 30) => fetch(`/api/git/log?${fsQuery(workspace, { limit })}`).then(json),
  gitDiff: (workspace, { path, origPath, staged }, { signal } = {}) =>
    fetch(`/api/git/diff?${fsQuery(workspace, { path, origPath: origPath || '', staged: staged ? '1' : '' })}`, { signal }).then(json),
  gitCheckout: (workspace, branch, { create = false, startPoint } = {}) =>
    post('/api/git/checkout', fsBody(workspace, startPoint ? { branch, create, startPoint } : { branch, create })),
  gitStage: (workspace, paths) => post('/api/git/stage', fsBody(workspace, { paths })),
  gitUnstage: (workspace, paths) => post('/api/git/unstage', fsBody(workspace, { paths })),
  gitDiscard: (workspace, paths) => post('/api/git/discard', fsBody(workspace, { paths })),
  gitCommit: (workspace, { message, amend = false }) => post('/api/git/commit', fsBody(workspace, { message, amend })),
  gitPush: (workspace, { force = false } = {}) => post('/api/git/push', fsBody(workspace, { force })),
  gitPull: (workspace) => post('/api/git/pull', fsBody(workspace, {})),
  gitFetch: (workspace) => post('/api/git/fetch', fsBody(workspace, {})),
  terminalSocketUrl: (id) =>
    `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/terminal/${encodeURIComponent(id)}/socket`,
}

export default api
