const fs = require('fs')
const config = require('../config')
const paths = require('../store/paths')
const { readJson, writeJson } = require('../store/jsonFile')
const sessionStore = require('../store/sessionStore')
const sessionIndex = require('../store/sessionIndex')
const sessionLock = require('../store/sessionLock')
const workspaceStore = require('../store/workspaceStore')
const eventLog = require('../store/eventLog')
const registry = require('../registry')

// A bound run is still in progress while it is running or waiting on the user.
// Failure, stop, pause, and a recovered interruption all end the wait.
const RUN_DONE = new Set(['completed', 'error', 'cancelled', 'interrupted', 'disconnected'])
const SESSION_DONE = new Set(['paused', 'stopped', 'error', 'disconnected', 'finished'])

const fail = (message, status) => {
  throw Object.assign(new Error(message), { status })
}

// Ids from the UI may be qualified as `<id>@<machine>`. This process only has local sessions.
const localId = (value) => {
  const trimmed = String(value).trim()
  const at = trimmed.lastIndexOf('@')
  return at < 0 ? trimmed : trimmed.slice(0, at)
}

const workspaceIdOf = (session) => session.workspaceId
  || workspaceStore.findWorkspaceByCwd(session.cwd, config.writeDir)?.id
  || null

const boundEnded = (depSession, run) => {
  if (!run) return true
  if (run.endedAt) return true
  if (RUN_DONE.has(run.status)) return true
  if (depSession?.status === 'awaiting_input' || depSession?.status === 'running') {
    const owner = readJson(paths.daemonPid(depSession.id, config.writeDir), null)
    return Boolean(owner?.runId === run.id && owner.pid && !sessionLock.ownerAlive(owner))
  }
  if (depSession && SESSION_DONE.has(depSession.status)) return true
  return false
}

const replyEntry = (session, mode) => {
  const workspace = registry.sessionWorkspace(session)
  const harness = workspace ? registry.makeHarnessApi(workspace, session) : undefined
  const entry = registry.requireMode(workspace, mode, { harness, provider: session.provider })
  if (entry.kind !== 'turn') fail(`run after does not support mode ${mode}`, 400)
  return entry
}

const claimFile = (sessionId) => paths.runAfterDispatchFile(sessionId, config.writeDir)
const cancelFile = (sessionId) => paths.runAfterCancelFile(sessionId, config.writeDir)

const readClaim = (sessionId) => readJson(claimFile(sessionId), null)

const clearFile = (file) => {
  try { fs.rmSync(file, { force: true }) } catch { /* already gone */ }
}

const clearClaim = (sessionId) => clearFile(claimFile(sessionId))
const clearCancel = (sessionId) => clearFile(cancelFile(sessionId))

const cancelled = (sessionId) => {
  try { return fs.existsSync(cancelFile(sessionId)) } catch { return false }
}

const requestCancel = (sessionId) => {
  writeJson(cancelFile(sessionId), { at: Date.now() })
}

const daemonAlive = (sessionId) => {
  const owner = readJson(paths.daemonPid(sessionId, config.writeDir), null)
  return sessionLock.ownerAlive(owner)
}

const cancelQueued = (session) => {
  clearClaim(session.id)
  clearCancel(session.id)
  clearFile(paths.controlFile(session.id, config.writeDir))
  for (const run of sessionStore.listRuns(session.id, config.writeDir)) {
    if (!run.endedAt) {
      sessionStore.updateRun(session.id, run.id, { status: 'cancelled', endedAt: Date.now() }, config.writeDir)
    }
  }
  const updated = sessionStore.updateSession(session.id, { status: 'stopped', runAfter: null }, config.writeDir)
  eventLog.append(session.id, { type: 'status', status: 'stopped' }, config.writeDir)
  return updated
}

const failLaunch = (session, message) => {
  const current = sessionStore.loadSession(session.id, config.writeDir) || session
  if (current.status === 'stopped') return current
  clearClaim(session.id)
  clearCancel(session.id)
  const run = sessionStore.listRuns(session.id, config.writeDir).at(-1)
  const runId = run?.id || null
  eventLog.append(session.id, { type: 'error', message, ...(runId ? { runId } : {}) }, config.writeDir)
  if (run && !run.endedAt) {
    sessionStore.updateRun(session.id, run.id, {
      status: 'error', error: message, endedAt: Date.now(),
    }, config.writeDir)
  }
  return sessionStore.updateSession(session.id, {
    status: 'error',
    runAfter: null,
    lastError: { message, runId, at: Date.now() },
  }, config.writeDir)
}

// Caller holds the session lock. File reads only; do not wait on the dependency.
const launchLocked = (session) => {
  const { prompt, mode } = session.runAfter
  let entry
  try {
    entry = replyEntry(session, mode)
  } catch (err) {
    failLaunch(session, err.message || String(err))
    return null
  }
  if (cancelled(session.id)) {
    cancelQueued(session)
    return null
  }
  writeJson(claimFile(session.id), {
    pid: process.pid,
    identity: sessionLock.identity(),
    at: Date.now(),
  })
  try {
    sessionStore.updateSession(session.id, { runAfter: null }, config.writeDir)
    if (cancelled(session.id)) {
      cancelQueued(sessionStore.loadSession(session.id, config.writeDir) || session)
      return null
    }
    return require('./Harness').spawnRun(session.id, entry.id === 'plan' ? 'plan' : 'run', {
      mode,
      prompt,
      autoName: Boolean(entry.autoName),
      allowQueued: true,
    })
  } catch (err) {
    const current = sessionStore.loadSession(session.id, config.writeDir) || session
    if (err.code === 'stopped' || cancelled(session.id)) {
      cancelQueued(current)
      return null
    }
    failLaunch(current, err.message || String(err))
    return null
  } finally {
    clearClaim(session.id)
  }
}

const dispatchOne = (sessionId) => {
  let lock
  try {
    lock = sessionLock.acquire(sessionId, config.writeDir)
  } catch (err) {
    if (err.status === 409) return null
    throw err
  }
  try {
    const session = sessionStore.loadSession(sessionId, config.writeDir)
    if (!session || session.status !== 'queued') return null
    if (cancelled(sessionId)) {
      cancelQueued(session)
      return null
    }
    if (!session.runAfter?.sessionId || !session.runAfter?.runId || session.runAfter.prompt == null || !session.runAfter.mode) {
      failLaunch(session, 'Queued run is missing its prompt')
      return null
    }
    if (daemonAlive(sessionId)) return null
    const claim = readClaim(sessionId)
    if (claim && sessionLock.ownerAlive(claim)) return null
    if (claim) {
      failLaunch(session, 'Queued run failed to start')
      return null
    }
    const dep = sessionStore.loadSession(session.runAfter.sessionId, config.writeDir)
    const bound = sessionStore.loadRun(session.runAfter.sessionId, session.runAfter.runId, config.writeDir)
    if (!boundEnded(dep, bound)) return null
    return launchLocked(session)
  } finally {
    lock.release()
  }
}

// Null means the dependency already ended and the caller should start the run now.
const enqueue = (session, { prompt, mode, runAfterSessionId }) => {
  if (typeof runAfterSessionId !== 'string') fail('runAfterSessionId must be a string', 400)
  const depId = localId(runAfterSessionId)
  if (!depId) fail('runAfterSessionId must be a session id', 400)
  if (sessionStore.listRuns(session.id, config.writeDir).length) {
    fail('runAfterSessionId is only allowed on the first prompt', 400)
  }
  if (session.status === 'queued') fail('session is queued', 409)
  if (['running', 'awaiting_input'].includes(session.status)) {
    fail(`Session ${session.id} already has an active run`, 409)
  }
  if (depId === session.id) fail('runAfterSessionId must be a different session', 400)
  const dep = sessionStore.loadSession(depId, config.writeDir)
  if (!dep) fail(`session not found: ${depId}`, 404)
  const workspaceId = workspaceIdOf(session)
  const depWorkspaceId = workspaceIdOf(dep)
  if (!workspaceId || workspaceId !== depWorkspaceId) {
    fail('runAfterSessionId must be a session in the same workspace', 400)
  }
  replyEntry(session, mode)
  const bound = sessionStore.listRuns(dep.id, config.writeDir).at(-1)
  if (!bound) fail('run after session has no run', 400)
  if (boundEnded(dep, bound)) return null
  clearClaim(session.id)
  clearCancel(session.id)
  const runAfter = {
    sessionId: dep.id,
    runId: bound.id,
    prompt: prompt == null ? '' : String(prompt),
    mode,
  }
  const patch = { status: 'queued', runAfter }
  if (!session.mode) patch.mode = mode
  const updated = sessionStore.updateSession(session.id, patch, config.writeDir)
  eventLog.append(session.id, {
    type: 'status',
    status: 'queued',
    runAfterSessionId: dep.id,
    runAfterRunId: bound.id,
  }, config.writeDir)
  const started = dispatchOne(session.id)
  if (started) return started
  const now = sessionStore.loadSession(session.id, config.writeDir) || updated
  if (now.status === 'error') fail(now.lastError?.message || 'Queued run failed to start', 400)
  if (now.status === 'stopped') fail('session is stopped', 409)
  if (now.status === 'queued') return { queued: true, session: now }
  const run = sessionStore.listRuns(session.id, config.writeDir).at(-1)
  if (!run) return { queued: true, session: now }
  const owner = readJson(paths.daemonPid(session.id, config.writeDir), null)
  return { ...run, daemonPid: sessionLock.ownerAlive(owner) ? owner.pid : null }
}

let pumping = false

const pump = async () => {
  if (pumping) return
  pumping = true
  try {
    for (const session of sessionIndex.query({ statuses: ['queued'], includeArchived: true })) {
      try { dispatchOne(session.id) }
      catch (err) {
        process.stderr.write(`run after ${session.id}: ${err && err.message ? err.message : err}\n`)
      }
      await new Promise(resolve => setImmediate(resolve))
    }
  } finally {
    pumping = false
  }
}

module.exports = {
  enqueue,
  dispatchOne,
  pump,
  cancelled,
  requestCancel,
  cancelQueued,
}
