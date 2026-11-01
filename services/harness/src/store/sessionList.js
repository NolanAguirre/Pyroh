const fs = require('fs')
const paths = require('./paths')
const workspaceStore = require('./workspaceStore')
const { loadSession, loadSessionAsync } = require('./sessionRecord')

const listSessionNames = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

const readSessionsFromDir = (dir, writeDir, remember) => {
  const sessions = []
  for (const name of listSessionNames(dir)) {
    if (remember) remember(name)
    const session = loadSession(name, writeDir)
    if (session) sessions.push(session)
  }
  return sessions
}

const listSessionsInWorkspace = (workspaceId, writeDir) => {
  const workspace = workspaceStore.loadWorkspace(workspaceId, writeDir)
  const sessions = readSessionsFromDir(
    paths.sessionsDir(workspaceId, writeDir),
    writeDir,
    (name) => paths.rememberSession(name, workspaceId, writeDir),
  )
  const legacy = readSessionsFromDir(
    paths.legacySessionsDir(writeDir),
    writeDir,
    (name) => paths.rememberLegacySession(name, writeDir),
  ).filter((session) => {
    if (session.workspaceId === workspaceId) return true
    if (session.workspaceId || !workspace) return false
    if (session.cwd !== workspace.cwd) return false
    const owner = workspaceStore.findWorkspaceByCwd(session.cwd, writeDir)
    return owner && owner.id === workspaceId
  })
  const byId = new Map()
  for (const session of [...sessions, ...legacy]) byId.set(session.id, session)
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt)
}

const listSessions = (writeDir, workspaceId) => {
  if (workspaceId) return listSessionsInWorkspace(workspaceId, writeDir)
  const byId = new Map()
  for (const workspace of workspaceStore.listWorkspaces(writeDir)) {
    for (const session of listSessionsInWorkspace(workspace.id, writeDir)) {
      byId.set(session.id, session)
    }
  }
  for (const session of readSessionsFromDir(
    paths.legacySessionsDir(writeDir),
    writeDir,
    (name) => paths.rememberLegacySession(name, writeDir),
  )) {
    if (!byId.has(session.id)) byId.set(session.id, session)
  }
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt)
}

const listSessionNamesAsync = async (dir) => {
  try {
    return (await fs.promises.readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

const readSessionsFromDirAsync = async (dir, writeDir, remember, workspaces) => {
  const names = await listSessionNamesAsync(dir)
  for (const name of names) remember(name)
  return (await Promise.all(names.map((name) => loadSessionAsync(name, writeDir, workspaces)))).filter(Boolean)
}

const readLegacySessionsAsync = (writeDir, workspaces) => readSessionsFromDirAsync(
  paths.legacySessionsDir(writeDir),
  writeDir,
  (name) => paths.rememberLegacySession(name, writeDir),
  workspaces,
)

const listSessionsInWorkspaceAsync = async (workspaceId, writeDir, { workspaces = new Map(), legacy } = {}) => {
  const [workspace, sessions, legacySessions] = await Promise.all([
    workspaceStore.loadWorkspaceAsync(workspaceId, writeDir),
    readSessionsFromDirAsync(
      paths.sessionsDir(workspaceId, writeDir),
      writeDir,
      (name) => paths.rememberSession(name, workspaceId, writeDir),
      workspaces,
    ),
    legacy || readLegacySessionsAsync(writeDir, workspaces),
  ])
  let allWorkspaces = null
  const owned = []
  for (const session of legacySessions) {
    if (session.workspaceId === workspaceId) owned.push(session)
    if (session.workspaceId || !workspace || session.cwd !== workspace.cwd) continue
    allWorkspaces ??= await workspaceStore.listWorkspacesAsync(writeDir)
    const owner = allWorkspaces.find((item) => item.cwd === session.cwd)
    if (owner && owner.id === workspaceId) owned.push(session)
  }
  const byId = new Map()
  for (const session of [...sessions, ...owned]) byId.set(session.id, session)
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt)
}

const listSessionsAsync = async (writeDir, workspaceId) => {
  const workspaces = new Map()
  const legacy = readLegacySessionsAsync(writeDir, workspaces)
  if (workspaceId) return listSessionsInWorkspaceAsync(workspaceId, writeDir, { workspaces, legacy })
  const byId = new Map()
  const lists = await Promise.all((await workspaceStore.listWorkspacesAsync(writeDir))
    .map((workspace) => listSessionsInWorkspaceAsync(workspace.id, writeDir, { workspaces, legacy })))
  for (const session of lists.flat()) byId.set(session.id, session)
  for (const session of await legacy) {
    if (!byId.has(session.id)) byId.set(session.id, session)
  }
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt)
}

module.exports = {
  listSessions,
  listSessionsAsync,
}
