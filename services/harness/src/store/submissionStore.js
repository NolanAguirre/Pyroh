const path = require('path')
const crypto = require('crypto')
const config = require('../config')
const paths = require('./paths')
const imageStore = require('./imageStore')
const { readJson, writeJson } = require('./jsonFile')
const { identity, ownerAlive } = require('./sessionLock')
const fileLock = require('./fileLock')

const owner = { pid: process.pid, identity: identity(), token: crypto.randomUUID() }
const active = new Set()
const actions = new Set(['run', 'commands', 'queue', 'steer', 'decompose'])
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const interruptedError = 'Submission was interrupted before its outcome was saved. It may already have been accepted. Check the session before submitting again; this submission will not be executed again.'
const fileFor = (sessionId, writeDir = config.writeDir) => path.join(paths.sessionDir(sessionId, writeDir), 'submissions.json')
const keyFor = (sessionId, id, writeDir) => `${fileFor(sessionId, writeDir)}\0${id}`
const read = (sessionId, writeDir) => readJson(fileFor(sessionId, writeDir), { submissions: [] })
const publicReceipt = ({ id, status, result, error }) => ({ id, status,
  ...(result === undefined ? {} : { result }), ...(error === undefined ? {} : { error }) })

// JSON object key order is immaterial; array order and every payload field count.
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

// A separate short-lived lock protects receipts across overlapping API processes.
// Never hold the run lock or a receipt lock during spellcheck or execution.
const withLock = (sessionId, writeDir, fn) => {
  let lock
  try {
    lock = fileLock.acquire(path.join(paths.sessionDir(sessionId, writeDir), 'submissions.lock'))
  } catch (cause) {
    throw Object.assign(new Error(`Could not lock submissions; retry with the same submission id: ${cause.message}`), { status: 503 })
  }
  try {
    return fn()
  } finally { lock.release() }
}

const abandoned = (sessionId, record, writeDir) => record.status === 'received' && (
  !ownerAlive(record.owner) || (record.owner?.pid === process.pid && (
    record.owner.token !== owner.token || !active.has(keyFor(sessionId, record.id, writeDir))
  ))
)

const recover = (sessionId, state, writeDir) => {
  let changed = false
  for (const record of state.submissions) {
    if (!abandoned(sessionId, record, writeDir)) continue
    record.status = 'failed'
    record.error = interruptedError
    delete record.owner
    changed = true
  }
  if (changed) writeJson(fileFor(sessionId, writeDir), state)
  return state
}

const list = (sessionId, writeDir = config.writeDir) => {
  let state = read(sessionId, writeDir)
  if (state.submissions.some(record => abandoned(sessionId, record, writeDir))) {
    state = withLock(sessionId, writeDir, () => recover(sessionId, read(sessionId, writeDir), writeDir))
  }
  return state.submissions.map(publicReceipt)
}
const listAsync = async (sessionId, writeDir = config.writeDir) => list(sessionId, writeDir)
const get = (sessionId, id, writeDir = config.writeDir) => list(sessionId, writeDir).find(record => record.id === id) || null

const receive = (sessionId, body, writeDir = config.writeDir) => {
  if (!body || Array.isArray(body) || typeof body !== 'object' || typeof body.id !== 'string' || !uuid.test(body.id)) {
    throw Object.assign(new Error('id must be a UUID'), { status: 400 })
  }
  const { id, ...payload } = body
  if (!actions.has(payload.action)) throw Object.assign(new Error('invalid submission action'), { status: 400 })
  if (payload.images !== undefined) payload.images = imageStore.normalizeImages(sessionId, payload.images, writeDir)
  return withLock(sessionId, writeDir, () => {
    const state = recover(sessionId, read(sessionId, writeDir), writeDir)
    const existing = state.submissions.find(record => record.id === id)
    if (existing) {
      if (canonical(existing.payload) !== canonical(payload)) {
        throw Object.assign(new Error('submission id already used with a different payload'), { status: 409 })
      }
      return { submission: publicReceipt(existing), created: false, payload: existing.payload }
    }
    const record = { id, status: 'received', payload, owner }
    state.submissions.push(record)
    writeJson(fileFor(sessionId, writeDir), state)
    active.add(keyFor(sessionId, id, writeDir))
    return { submission: publicReceipt(record), created: true, payload }
  })
}

const finish = (sessionId, id, terminal, writeDir = config.writeDir) => withLock(sessionId, writeDir, () => {
  const state = read(sessionId, writeDir)
  const record = state.submissions.find(record => record.id === id)
  if (!record || record.status !== 'received' || record.owner?.token !== owner.token) return
  Object.assign(record, terminal)
  delete record.owner
  writeJson(fileFor(sessionId, writeDir), state)
})

const release = (sessionId, id, writeDir = config.writeDir) => active.delete(keyFor(sessionId, id, writeDir))

module.exports = { fileFor, list, listAsync, get, receive, finish, release, interruptedError }
