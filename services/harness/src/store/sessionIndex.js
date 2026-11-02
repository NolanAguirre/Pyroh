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
    // This is a rebuildable mirror. API writes must not freeze requests while
    // another process holds the writer lock; reconciliation repairs a miss.
    db.exec(`PRAGMA busy_timeout = ${process.env.HARNESS_MAINTENANCE_WORKER === '1' ? 1000 : 50}`)
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
    const db = open()
    const workspaceId = paths.locateSession(session.id, writeDir)?.workspaceId ||
      session.workspaceId ||
      ownerByCwd(session, workspaceStore.listWorkspaces(writeDir))
    db.exec('BEGIN IMMEDIATE')
    try {
      writeRow(session, mtimeMs, workspaceId)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  } catch (err) {
    report(err)
  }
}

// Provider option blobs are only needed by the session detail view.
const LIST_OMIT = ['codex', 'grok', 'claude']

const listRow = (session) => {
  const row = { ...session }
  for (const key of LIST_OMIT) delete row[key]
  return row
}

const query = ({ workspaceId, includeArchived = false, active, statuses, provider, updatedSince, orderBy = 'createdAt', order = 'desc', limit, fields } = {}) => {
  const db = open()
  const where = []
  const params = {}
  if (workspaceId) {
    where.push('workspace_id = :workspaceId')
    params.workspaceId = workspaceId
  }
  if (!includeArchived) where.push('archived = 0')
  if (statuses) {
    if (!statuses.length) return []
    where.push(`status IN (${statuses.map((status, index) => {
      params[`status${index}`] = status
      return `:status${index}`
    }).join(', ')})`)
  }
  if (provider) {
    where.push('provider = :provider')
    params.provider = provider
  }
  if (updatedSince !== undefined) {
    where.push('updated_at >= :updatedSince')
    params.updatedSince = updatedSince
  }
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
  const sessions = db.prepare(sql).all(params).map((row) => JSON.parse(row.data))
  return fields === 'list' ? sessions.map(listRow) : sessions
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

const inBatches = async (items, visit, size = 32) => {
  const results = []
  for (let at = 0; at < items.length; at += size) {
    results.push(...await Promise.all(items.slice(at, at + size).map(visit)))
  }
  return results
}

// Rows are read before the directory walk so sessions created mid-walk are never deleted.
const reconcileOnce = async (writeDir, force) => {
  const db = open()
  const rows = new Map(data.statements.mtimes.all().map((row) => [row.session_id, row.source_mtime_ms]))
  const workspaces = await workspaceStore.listWorkspacesAsync(writeDir)
  const sources = await listSources(writeDir, workspaces)
  const present = (await inBatches(sources, async (source) => ({ ...source, mtimeMs: await statMtime(source.file) })))
    .filter((source) => source.mtimeMs !== null)
  const changed = (await inBatches(present
    .filter((source) => force || rows.get(source.id) !== source.mtimeMs), readChanged))
    .filter(Boolean)
  const keep = new Set(present.map((source) => source.id))
  const removed = [...rows.keys()].filter(id => !keep.has(id))
  const changes = [
    ...changed.map(({ source, session }) => () => writeRow(session, source.mtimeMs,
      source.workspaceId || session.workspaceId || ownerByCwd(session, workspaces))),
    ...removed.map(id => () => data.statements.remove.run(id)),
  ]
  // Short transactions allow API writes between batches; an unchanged sweep
  // never takes the SQLite writer lock.
  for (let at = 0; at < changes.length; at += 64) {
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const change of changes.slice(at, at + 64)) change()
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
    await new Promise(resolve => setImmediate(resolve))
  }
  return { indexed: changed.length, removed: removed.length, total: present.length }
}

const reconcile = (writeDir = config.writeDir, { force = false } = {}) => {
  if (data.reconciling) return data.reconciling
  const run = reconcileOnce(writeDir, force).finally(() => { data.reconciling = null })
  data.reconciling = run
  data.ready ??= run.catch(() => {})
  return run
}

const whenReady = () => data.ready || Promise.resolve()

// Existing installations can serve their saved index immediately. A genuinely
// empty index must finish its first seed before the UI decides a chat is gone.
const waitForInitialSeed = (ready) => {
  if (open().prepare('SELECT 1 FROM main.session LIMIT 1').get()) return
  data.ready = ready
}

module.exports = {
  upsert,
  query,
  reconcile,
  whenReady,
  waitForInitialSeed,
}
