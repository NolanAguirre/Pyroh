const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { DatabaseSync } = require('node:sqlite')
const config = require('../config')
const paths = require('./paths')
const workspaceStore = require('./workspaceStore')
const { readJsonAsync } = require('./jsonFile')

const BUSY = ['running', 'awaiting_input']

const data = Object.create(null)
data.db = null
data.statements = null
data.ready = null
data.reconciling = null
data.lastError = null

const report = (err) => {
  const message = `session index: ${err && err.message ? err.message : err}`
  if (message === data.lastError) return
  data.lastError = message
  process.stderr.write(`${message}\n`)
}

const prepare = (db) => ({
  addStatus: db.prepare('INSERT OR IGNORE INTO main.session_status (name) VALUES (?)'),
  addProvider: db.prepare('INSERT OR IGNORE INTO main.provider (name) VALUES (?)'),
  upsert: db.prepare(`
    INSERT INTO main.session AS s (
      id, status, provider, session_id, workspace_id, name, model, archived, pinned,
      source_mtime_ms, data, created_at, updated_at
    ) VALUES (
      :id, :status, :provider, :sessionId, :workspaceId, :name, :model, :archived, :pinned,
      :mtimeMs, :data, :createdAt, :updatedAt
    )
    ON CONFLICT (session_id) DO UPDATE SET
      status = excluded.status,
      provider = excluded.provider,
      workspace_id = excluded.workspace_id,
      name = excluded.name,
      model = excluded.model,
      archived = excluded.archived,
      pinned = excluded.pinned,
      source_mtime_ms = excluded.source_mtime_ms,
      data = excluded.data,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
    WHERE excluded.source_mtime_ms >= s.source_mtime_ms
  `),
  remove: db.prepare('DELETE FROM main.session WHERE session_id = ?'),
  mtimes: db.prepare('SELECT session_id, source_mtime_ms FROM main.session'),
})

// WAL and a busy timeout let the server, daemons, and CLI write concurrently.
const open = () => {
  if (data.db) return data.db
  const db = new DatabaseSync(config.dbPath)
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')
    const table = db.prepare("SELECT 1 FROM main.sqlite_master WHERE type = 'table' AND name = 'session'").get()
    if (!table) throw new Error(`main.session is missing in ${config.dbPath}; run \`make db.harness.deploy\``)
    data.statements = prepare(db)
  } catch (err) {
    db.close()
    throw err
  }
  data.db = db
  return db
}

const ownerByCwd = (session, workspaces) => {
  const cwd = session.cwd || config.workBase
  const owner = workspaces.find((workspace) => workspace.cwd === cwd)
  return owner ? owner.id : null
}

// Unknown statuses and providers are registered so their rows still satisfy the lookups.
const writeRow = (session, mtimeMs, workspaceId) => {
  const statements = data.statements
  if (session.status) statements.addStatus.run(session.status)
  if (session.provider) statements.addProvider.run(session.provider)
  statements.upsert.run({
    id: crypto.randomUUID(),
    status: session.status || null,
    provider: session.provider || null,
    sessionId: session.id,
    workspaceId: workspaceId || null,
    name: session.name ?? null,
    model: session.model ?? null,
    archived: session.archived ? 1 : 0,
    pinned: session.pinned ? 1 : 0,
    mtimeMs,
    data: JSON.stringify(session),
    createdAt: session.createdAt ?? 0,
    updatedAt: session.updatedAt ?? null,
  })
}

// Never throws: a failed index write must not break the caller's file write.
const upsert = (session, mtimeMs, writeDir = config.writeDir) => {
  try {
    open()
    const workspaceId = paths.locateSession(session.id, writeDir)?.workspaceId ||
      session.workspaceId ||
      ownerByCwd(session, workspaceStore.listWorkspaces(writeDir))
    writeRow(session, mtimeMs, workspaceId)
  } catch (err) {
    report(err)
  }
}

const query = ({ workspaceId, includeArchived = false, active, orderBy = 'createdAt', order = 'desc', limit } = {}) => {
  const db = open()
  const where = []
  const params = {}
  if (workspaceId) {
    where.push('workspace_id = :workspaceId')
    params.workspaceId = workspaceId
  }
  if (!includeArchived) where.push('archived = 0')
  const busy = BUSY.map((status) => `'${status}'`).join(', ')
  if (active === true) where.push(`status IN (${busy})`)
  if (active === false) where.push(`COALESCE(status, '') NOT IN (${busy})`)
  const column = orderBy === 'updatedAt' ? 'COALESCE(updated_at, created_at)' : 'created_at'
  const direction = order === 'asc' ? 'ASC' : 'DESC'
  let sql = `SELECT data FROM main.session${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`
  sql += ` ORDER BY ${column} ${direction}, session_id ${direction}`
  if (limit !== undefined) {
    sql += ' LIMIT :limit'
    params.limit = limit
  }
  return db.prepare(sql).all(params).map((row) => JSON.parse(row.data))
}

const statMtime = async (file) => {
  try {
    return (await fs.promises.stat(file)).mtimeMs
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

const listDirNames = async (dir) => {
  try {
    return (await fs.promises.readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

const listSources = async (writeDir, workspaces) => {
  const sources = []
  const seen = new Set()
  for (const workspace of workspaces) {
    const dir = paths.sessionsDir(workspace.id, writeDir)
    for (const name of await listDirNames(dir)) {
      if (seen.has(name)) continue
      seen.add(name)
      paths.rememberSession(name, workspace.id, writeDir)
      sources.push({ id: name, workspaceId: workspace.id, file: path.join(dir, name, 'session.json') })
    }
  }
  const legacyDir = paths.legacySessionsDir(writeDir)
  for (const name of await listDirNames(legacyDir)) {
    if (seen.has(name)) continue
    seen.add(name)
    paths.rememberLegacySession(name, writeDir)
    sources.push({ id: name, workspaceId: null, file: path.join(legacyDir, name, 'session.json') })
  }
  return sources
}

const readChanged = async (source) => {
  try {
    const session = await readJsonAsync(source.file, null)
    if (!session) return null
    if (await statMtime(source.file) !== source.mtimeMs) return null
    return { source, session: { ...session, id: session.id || source.id } }
  } catch (err) {
    report(new Error(`skipped ${source.file}: ${err.message}`))
    return null
  }
}

// Rows are read before the directory walk so sessions created mid-walk are never deleted.
const reconcileOnce = async (writeDir, force) => {
  const db = open()
  const rows = new Map(data.statements.mtimes.all().map((row) => [row.session_id, row.source_mtime_ms]))
  const workspaces = await workspaceStore.listWorkspacesAsync(writeDir)
  const sources = await listSources(writeDir, workspaces)
  const present = (await Promise.all(sources.map(async (source) => ({ ...source, mtimeMs: await statMtime(source.file) }))))
    .filter((source) => source.mtimeMs !== null)
  const changed = (await Promise.all(present
    .filter((source) => force || rows.get(source.id) !== source.mtimeMs)
    .map(readChanged)))
    .filter(Boolean)
  const keep = new Set(present.map((source) => source.id))
  let removed = 0
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const { source, session } of changed) {
      writeRow(session, source.mtimeMs, source.workspaceId || session.workspaceId || ownerByCwd(session, workspaces))
    }
    for (const id of rows.keys()) {
      if (keep.has(id)) continue
      data.statements.remove.run(id)
      removed += 1
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return { indexed: changed.length, removed, total: present.length }
}

const reconcile = (writeDir = config.writeDir, { force = false } = {}) => {
  if (data.reconciling) return data.reconciling
  const run = reconcileOnce(writeDir, force).finally(() => { data.reconciling = null })
  data.reconciling = run
  data.ready ??= run.catch(() => {})
  return run
}

const whenReady = () => data.ready || Promise.resolve()

module.exports = {
  upsert,
  query,
  reconcile,
  whenReady,
}
