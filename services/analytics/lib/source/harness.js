const fs = require('fs')
const path = require('path')
const config = require('../config')
const { readJson } = require('./usage')

// Reads the harness write dir layout:
//   workspaces/<wid>/workspace.json
//   workspaces/<wid>/sessions/<sid>/session.json
//   sessions/<sid>/session.json (legacy, no workspace dir)

const workspacesDir = (writeDir) => path.join(writeDir, 'workspaces')
const legacySessionsDir = (writeDir) => path.join(writeDir, 'sessions')

const listEntries = async (dir) => {
  try {
    return await fs.promises.readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return []
    throw err
  }
}

const listDirs = async (dir) => (await listEntries(dir))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)

const statOrNull = async (file) => {
  try {
    return await fs.promises.stat(file)
  } catch {
    return null
  }
}

const listWorkspaces = async (writeDir = config.harnessWriteDir) => {
  const ids = await listDirs(workspacesDir(writeDir))
  const found = await Promise.all(ids.map(async (id) => {
    const meta = await readJson(path.join(workspacesDir(writeDir), id, 'workspace.json'))
    return {
      id,
      name: (meta && meta.name) || null,
      path: (meta && (meta.cwd || meta.path)) || null,
      meta,
    }
  }))
  return found
}

const readWorkspace = async (id, writeDir = config.harnessWriteDir) => {
  const meta = await readJson(path.join(workspacesDir(writeDir), id, 'workspace.json'))
  return { id, name: (meta && meta.name) || null, path: (meta && (meta.cwd || meta.path)) || null, meta }
}

const listSessionDirs = async (writeDir = config.harnessWriteDir) => {
  const workspaceIds = await listDirs(workspacesDir(writeDir))
  const found = (await Promise.all(workspaceIds.map(async (workspaceId) => {
    const dir = path.join(workspacesDir(writeDir), workspaceId, 'sessions')
    return (await listDirs(dir)).map((sessionId) => ({ sessionId, workspaceId, dir: path.join(dir, sessionId) }))
  }))).flat()
  const legacyDir = legacySessionsDir(writeDir)
  for (const sessionId of await listDirs(legacyDir)) {
    found.push({ sessionId, workspaceId: null, dir: path.join(legacyDir, sessionId) })
  }
  return found
}

const locateSession = async (sessionId, writeDir = config.harnessWriteDir) => {
  for (const workspaceId of await listDirs(workspacesDir(writeDir))) {
    const dir = path.join(workspacesDir(writeDir), workspaceId, 'sessions', sessionId)
    if (await statOrNull(path.join(dir, 'session.json'))) return { sessionId, workspaceId, dir }
  }
  const dir = path.join(legacySessionsDir(writeDir), sessionId)
  if (await statOrNull(path.join(dir, 'session.json'))) return { sessionId, workspaceId: null, dir }
  return null
}

// Aggregate of a file group: deleting, adding, or rewriting a file changes it.
const groupFingerprint = async (files) => {
  const stats = (await Promise.all(files.map(statOrNull))).filter(Boolean)
  return {
    count: stats.length,
    size: stats.reduce((sum, stat) => sum + stat.size, 0),
    mtime: stats.reduce((max, stat) => Math.max(max, stat.mtimeMs), 0),
  }
}

const filesIn = async (dir) => (await listEntries(dir))
  .filter((entry) => entry.isFile())
  .map((entry) => path.join(dir, entry.name))

// Root-level json records feed run usage (decompose step files such as
// count.json); session.json and control.json change on every status update.
const ROOT_SKIP = new Set(['session.json', 'control.json'])

const describeSession = async (loc) => {
  const meta = await readJson(path.join(loc.dir, 'session.json'))
  if (!meta) return null

  const entries = await listEntries(loc.dir)
  const rootNames = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name))
  const phaseDirs = entries
    .filter((entry) => entry.isDirectory() && /^phase-/.test(entry.name))
    .map((entry) => path.join(loc.dir, entry.name))

  const runsDir = path.join(loc.dir, 'runs')
  const [runFiles, usageFiles, phaseFiles] = await Promise.all([
    filesIn(runsDir),
    filesIn(path.join(loc.dir, 'usage')),
    Promise.all(phaseDirs.map(filesIn)).then((lists) => lists.flat()),
  ])
  const rootJson = [...rootNames]
    .filter((name) => name.endsWith('.json') && !ROOT_SKIP.has(name))
    .map((name) => path.join(loc.dir, name))
  // Step records sit next to their <step>.prompt.txt.
  const rootSteps = rootJson.filter((file) => rootNames.has(`${path.basename(file, '.json')}.prompt.txt`))

  const eventsPath = path.join(loc.dir, 'events.jsonl')
  const events = await statOrNull(eventsPath)

  const transcriptPaths = [
    ...rootSteps,
    ...phaseFiles.filter((file) => file.endsWith('.json')),
  ].sort()

  const [usage, runs, phases, root] = await Promise.all([
    groupFingerprint(usageFiles),
    groupFingerprint(runFiles),
    groupFingerprint(phaseFiles),
    groupFingerprint(rootJson),
  ])

  return {
    id: loc.sessionId,
    workspaceId: meta.workspaceId || loc.workspaceId || null,
    name: meta.name || null,
    provider: meta.provider || null,
    model: meta.model || null,
    cwd: meta.cwd || null,
    archived: Boolean(meta.archived),
    createdAt: Number.isFinite(meta.createdAt) ? meta.createdAt : null,
    updatedAt: Number.isFinite(meta.updatedAt) ? meta.updatedAt : null,
    sessionDir: loc.dir,
    eventsPath: events ? eventsPath : null,
    transcriptPaths,
    fingerprint: {
      events: events ? { size: events.size, mtime: events.mtimeMs } : null,
      usage,
      runs,
      phases,
      root,
    },
    meta,
  }
}

// First location wins when a session id appears both under a workspace and in
// the legacy dir, matching the harness lookup order.
const describeAll = async (writeDir = config.harnessWriteDir) => {
  const seen = new Set()
  const locs = (await listSessionDirs(writeDir)).filter((loc) => {
    if (seen.has(loc.sessionId)) return false
    seen.add(loc.sessionId)
    return true
  })
  return (await Promise.all(locs.map(describeSession))).filter(Boolean)
}

module.exports = {
  listWorkspaces,
  readWorkspace,
  listSessionDirs,
  locateSession,
  describeSession,
  describeAll,
}
