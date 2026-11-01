const crypto = require('crypto')
const { DatabaseSync } = require('node:sqlite')
const config = require('./config')

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const ID_LENGTH = 7
const MAX_ATTEMPTS = 1000

const ROUTE_ID = /^[A-Za-z0-9_-]+$/

const isRouteId = (value) => typeof value === 'string' && ROUTE_ID.test(value)

const data = Object.create(null)
data.db = null
data.insert = null

const open = () => {
  if (data.db) return data.db
  const db = new DatabaseSync(config.dbFile)
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec('PRAGMA journal_mode = WAL')
    const table = db.prepare("SELECT 1 FROM main.sqlite_master WHERE type = 'table' AND name = 'dev_ids'").get()
    if (!table) throw new Error(`main.dev_ids is missing in ${config.dbFile}; run \`make db.mcpdevid.deploy\``)
    data.insert = db.prepare(`
      INSERT OR IGNORE INTO main.dev_ids (id, source, workspace_id, session_id, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)
  } catch (err) {
    db.close()
    throw err
  }
  data.db = db
  return db
}

const genId = () => Array.from({ length: ID_LENGTH }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('')

const inTransaction = (fn) => {
  const db = open()
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

const issueIds = (count, { workspaceId, sessionId = null }) => {
  if (!isRouteId(workspaceId)) throw new Error(`invalid workspace id: ${workspaceId}`)
  if (sessionId !== null && !isRouteId(sessionId)) throw new Error(`invalid session id: ${sessionId}`)
  return inTransaction(() => {
    const ids = []
    const now = Date.now()
    for (let attempts = 0; ids.length < count; attempts += 1) {
      if (attempts >= MAX_ATTEMPTS) throw new Error(`could not issue ${count} unique ids`)
      const id = genId()
      if (data.insert.run(id, 'mcp', workspaceId, sessionId, now).changes) ids.push(id)
    }
    return ids
  })
}

const importIds = (ids, source) => inTransaction(() => {
  const now = Date.now()
  return ids.reduce((added, id) => added + Number(data.insert.run(id, source, null, null, now).changes), 0)
})

module.exports = { isRouteId, issueIds, importIds }
