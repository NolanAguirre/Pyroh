const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const config = require('../config')
const paths = require('./paths')
const { readJson, readJsonAsync, writeJson, ensureDir } = require('./jsonFile')

const genId = (prefix) => `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`

const pidAlive = (pid) => {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}

const defaultNameForCwd = (cwd) => {
  const base = path.basename(cwd || '')
  return base || 'Workspace'
}

const createWorkspace = ({ name, cwd }, writeDir) => {
  if (!cwd) throw new Error('cwd is required')
  const id = genId('w')
  const now = Date.now()
  const workspace = {
    id,
    name: (name && String(name).trim()) || defaultNameForCwd(cwd),
    cwd,
    createdAt: now,
    updatedAt: now,
  }
  writeJson(paths.workspaceFile(id, writeDir), workspace)
  ensureDir(paths.sessionsDir(id, writeDir))
  return workspace
}

const loadWorkspace = (workspaceId, writeDir) =>
  readJson(paths.workspaceFile(workspaceId, writeDir), null)

const listWorkspaces = (writeDir) => {
  const dir = paths.workspacesDir(writeDir)
  let names
  try {
    names = fs.readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
  const workspaces = []
  for (const entry of names) {
    if (!entry.isDirectory()) continue
    const workspace = loadWorkspace(entry.name, writeDir)
    if (workspace) workspaces.push(workspace)
  }
  workspaces.sort((a, b) => a.name.localeCompare(b.name) || b.createdAt - a.createdAt)
  return workspaces
}

const loadWorkspaceAsync = (workspaceId, writeDir) =>
  readJsonAsync(paths.workspaceFile(workspaceId, writeDir), null)

const listWorkspacesAsync = async (writeDir) => {
  let names
  try {
    names = await fs.promises.readdir(paths.workspacesDir(writeDir), { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
  const workspaces = (await Promise.all(names
    .filter((entry) => entry.isDirectory())
    .map((entry) => loadWorkspaceAsync(entry.name, writeDir))))
    .filter(Boolean)
  workspaces.sort((a, b) => a.name.localeCompare(b.name) || b.createdAt - a.createdAt)
  return workspaces
}

const updateWorkspace = (workspaceId, patch, writeDir) => {
  const workspace = loadWorkspace(workspaceId, writeDir)
  if (!workspace) throw new Error(`workspace not found: ${workspaceId}`)
  const next = { ...workspace, ...patch, id: workspace.id, updatedAt: Date.now() }
  writeJson(paths.workspaceFile(workspaceId, writeDir), next)
  return next
}

const resolveSessionCwd = (session, writeDir) => {
  if (!session) return config.workBase
  if (session.workspaceId) {
    const workspace = loadWorkspace(session.workspaceId, writeDir)
    if (workspace && workspace.cwd) return workspace.cwd
  }
  return session.cwd || config.workBase
}

// `workspaces` memoizes workspace loads across a batch of sessions.
const resolveSessionCwdAsync = async (session, writeDir, workspaces = new Map()) => {
  if (!session) return config.workBase
  if (session.workspaceId) {
    if (!workspaces.has(session.workspaceId)) {
      workspaces.set(session.workspaceId, loadWorkspaceAsync(session.workspaceId, writeDir))
    }
    const workspace = await workspaces.get(session.workspaceId)
    if (workspace && workspace.cwd) return workspace.cwd
  }
  return session.cwd || config.workBase
}

const findWorkspaceByCwd = (cwd, writeDir) =>
  listWorkspaces(writeDir).find((workspace) => workspace.cwd === cwd) || null

const daemonAliveAt = (sessionDir) => {
  const record = readJson(path.join(sessionDir, 'daemon.pid'), null)
  return record && pidAlive(record.pid)
}

const listDirNames = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

// Move idle sessions from <write-dir>/sessions into workspaces grouped by cwd.
// Sessions with a live daemon stay in place so open log paths keep working.
const migrateLegacySessions = (writeDir) => {
  const legacyDir = paths.legacySessionsDir(writeDir)
  const names = listDirNames(legacyDir)
  if (names.length === 0) return { moved: 0, skipped: 0 }

  let moved = 0
  let skipped = 0
  for (const name of names) {
    const fromDir = path.join(legacyDir, name)
    const file = path.join(fromDir, 'session.json')
    const session = readJson(file, null)
    if (!session) continue

    let workspace = session.workspaceId
      ? loadWorkspace(session.workspaceId, writeDir)
      : findWorkspaceByCwd(session.cwd, writeDir)
    if (!workspace) {
      workspace = createWorkspace(
        { name: defaultNameForCwd(session.cwd), cwd: session.cwd || config.workBase },
        writeDir,
      )
    }

    if (daemonAliveAt(fromDir)) {
      paths.rememberLegacySession(name, writeDir)
      skipped += 1
      continue
    }

    if (!session.workspaceId || session.workspaceId !== workspace.id) {
      writeJson(file, { ...session, workspaceId: workspace.id, updatedAt: Date.now() })
    }

    const toDir = path.join(paths.sessionsDir(workspace.id, writeDir), name)
    if (fromDir === toDir) {
      paths.rememberSession(name, workspace.id, writeDir)
      continue
    }
    ensureDir(path.dirname(toDir))
    try {
      fs.renameSync(fromDir, toDir)
    } catch (err) {
      if (err.code === 'ENOENT') continue
      if (err.code === 'EEXIST' || err.code === 'ENOTEMPTY') {
        paths.rememberSession(name, workspace.id, writeDir)
        continue
      }
      throw err
    }
    writeJson(path.join(toDir, 'session.json'), {
      ...session,
      workspaceId: workspace.id,
      updatedAt: Date.now(),
    })
    paths.rememberSession(name, workspace.id, writeDir)
    moved += 1
  }

  try {
    if (listDirNames(legacyDir).length === 0) fs.rmdirSync(legacyDir)
  } catch {
    // leftover files are fine
  }

  return { moved, skipped }
}

const ensureLayout = (writeDir = config.writeDir) => {
  ensureDir(paths.workspacesDir(writeDir))
  return migrateLegacySessions(writeDir)
}

module.exports = {
  genId,
  defaultNameForCwd,
  createWorkspace,
  loadWorkspace,
  loadWorkspaceAsync,
  listWorkspaces,
  listWorkspacesAsync,
  updateWorkspace,
  resolveSessionCwd,
  resolveSessionCwdAsync,
  findWorkspaceByCwd,
  migrateLegacySessions,
  ensureLayout,
}
