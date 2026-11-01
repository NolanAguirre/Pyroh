const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')
const config = require('../config')
const paths = require('../store/paths')
const store = require('../store/sessionStore')
const { readJson, writeJson } = require('../store/jsonFile')
const locks = require('../store/sessionLock')
const questions = require('../store/questionStore')
const registry = require('../registry')

const fileFor = (sessionId, runId) => path.join(paths.sessionDir(sessionId, config.writeDir), 'delegation', `${runId}.json`)
const credentialFile = (hash) => path.join(config.writeDir, 'delegation-credentials', `${hash}.json`)
const hashOf = (value) => crypto.createHash('sha256').update(value).digest('hex')
const fail = (message) => { throw Object.assign(new Error(message), { status: 403 }) }
const withLock = (sessionId, runId, fn) => {
  const file = fileFor(sessionId, runId)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const fd = fs.openSync(`${file}.lock`, 'a', 0o600)
  try {
    const result = spawnSync('flock', ['3'], { stdio: ['ignore', 'pipe', 'pipe', fd] })
    if (result.error || result.status !== 0) throw new Error('Could not lock child records')
    return fn(file)
  } finally { fs.closeSync(fd) }
}

const parentActive = (sessionId, runId) => {
  const session = store.loadSession(sessionId, config.writeDir)
  const run = store.loadRun(sessionId, runId, config.writeDir)
  const owner = readJson(paths.daemonPid(sessionId, config.writeDir))
  return Boolean(session && !session.parentRunId && ['running', 'awaiting_input'].includes(session.status) &&
    run?.status === 'running' && !run.endedAt && owner?.runId === runId && locks.ownerAlive(owner))
}

const open = (session, runId, baseMode) => withLock(session.id, runId, (file) => {
  if (!parentActive(session.id, runId)) fail('Delegation requires an active top-level parent run')
  const previous = readJson(file)
  if (previous?.closed) fail('Delegation is closed for this run')
  const token = crypto.randomBytes(32).toString('hex')
  const hash = hashOf(token)
  writeJson(file, { ...previous, sessionId: session.id, runId, baseMode, credentialHash: hash, children: previous?.children || {} })
  writeJson(credentialFile(hash), { sessionId: session.id, runId })
  return { name: 'harness_agents', url: `${config.publicUrl}/mcp/agents/${token}` }
})

const authenticate = (token) => {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) fail('Invalid delegation credential')
  const hash = hashOf(token)
  const binding = readJson(credentialFile(hash))
  if (!binding) fail('Invalid delegation credential')
  const state = readJson(fileFor(binding.sessionId, binding.runId))
  if (!state || state.credentialHash !== hash || state.closed || !parentActive(binding.sessionId, binding.runId)) {
    fail('Parent run is no longer active')
  }
  return { ...binding, hash }
}

const stateFor = (context) => {
  const state = readJson(fileFor(context.sessionId, context.runId))
  if (!state || state.closed || state.credentialHash !== context.hash || !parentActive(context.sessionId, context.runId)) {
    fail('Parent run is no longer active')
  }
  return state
}

const targetFor = (parent, state, args) => {
  const provider = args.provider || 'cursor'
  const model = args.model || (provider === 'cursor' ? 'grok-4.7' : null)
  const mode = args.mode || state.baseMode
  const rank = { agent: 0, plan: 1, ask: 2 }
  if (!Object.hasOwn(rank, mode) || rank[mode] < rank[state.baseMode]) fail('Child mode must be at least as restrictive as the parent base mode')
  if (!require('../agents/driver').listProviders().includes(provider)) fail(`Unknown provider: ${provider}`)
  registry.requireMode(registry.sessionWorkspace(parent), mode, { provider })
  if (provider === 'grok' && mode !== 'agent') fail('Grok restricted child modes cannot be enforced by its current transport; use Cursor, Codex, or Claude')
  // Provider-specific boundaries cannot safely be translated to another provider.
  if (parent.provider === 'codex' && ((parent.codex?.sandbox || 'danger-full-access') !== 'danger-full-access' || (parent.codex?.approvalPolicy || 'never') !== 'never') && provider !== 'codex') {
    fail('This parent has Codex sandbox or approval restrictions; choose a Codex child')
  }
  if (parent.provider === 'claude' && parent.claude?.permissionMode && parent.claude.permissionMode !== 'bypassPermissions' && provider !== 'claude') {
    fail('This parent has Claude approval restrictions; choose a Claude child')
  }
  return { provider, model, mode,
    ...(provider === 'codex' && parent.provider === 'codex' ? { codex: parent.codex } : {}),
    ...(provider === 'claude' && parent.provider === 'claude' ? { claude: parent.claude } : {}),
    ...(provider === 'grok' && parent.provider === 'grok' ? { grok: parent.grok } : {}),
  }
}

const describe = (child) => {
  if (child.sessionId && child.runId) {
    const unfinished = store.loadRun(child.sessionId, child.runId, config.writeDir)
    if (unfinished && !unfinished.endedAt) {
      let lock
      try {
        lock = locks.acquire(child.sessionId, config.writeDir)
        store.recoverSession(child.sessionId, config.writeDir)
      } catch (err) { if (err.status !== 409) throw err }
      finally { lock?.release() }
    }
  }
  const session = child.sessionId && store.loadSession(child.sessionId, config.writeDir)
  const run = child.runId && store.loadRun(child.sessionId, child.runId, config.writeDir)
  const done = Boolean(run?.endedAt || child.error)
  return {
    sessionId: child.sessionId || null, runId: child.runId || null,
    workspaceId: session?.workspaceId, parentRunId: session?.parentRunId,
    transcriptLink: session ? `/?workspace=${encodeURIComponent(session.workspaceId)}&session=${encodeURIComponent(session.id)}` : null,
    state: child.error ? 'error' : done ? run.status : session?.status === 'awaiting_input' ? 'awaiting_input' : run?.status || 'starting',
    done, provider: session?.provider, model: session?.model, mode: run?.mode,
    pendingQuestions: session ? questions.listQuestions(session.id, config.writeDir).filter(q => q.runId === child.runId && q.status === 'pending') : [],
    error: child.error || run?.error || null,
    usage: run?.usage ?? null, normalizedUsage: store.normalizeUsage(run?.usage, session?.provider),
    durationMs: run?.durationMs || (run ? Math.max(0, (run.endedAt || Date.now()) - run.startedAt) : 0),
    ...(done ? { finalResponse: run?.result ?? null } : {}),
  }
}

const spawn = (context, args) => withLock(context.sessionId, context.runId, (file) => {
  const state = stateFor(context)
  if (typeof args.task !== 'string' || !args.task.trim()) fail('task must be a nonempty string')
  if (typeof args.retryKey !== 'string' || !args.retryKey.trim() || args.retryKey.length > 256) fail('retryKey is required (1–256 characters)')
  const key = hashOf(args.retryKey)
  const requestHash = hashOf(JSON.stringify([args.task, args.provider || null, args.model || null, args.mode || null]))
  const prior = state.children[key]
  if (prior) {
    if (prior.requestHash !== requestHash) fail('retryKey was already used for a different request')
    if (!prior.runId && !prior.error) {
      prior.error = 'Spawn was interrupted before launch; this retry key remains reserved. Use a new key for a new attempt.'
      writeJson(file, state)
    }
    return describe(prior)
  }
  if (Object.values(state.children).filter(child => !describe(child).done).length >= 4) fail('Child limit reached: at most four active children per parent run')
  const parent = store.loadSession(context.sessionId, config.writeDir)
  const target = targetFor(parent, state, args)
  const child = { requestHash, createdAt: Date.now() }
  state.children[key] = child
  // Reserve the key durably before creating a session or launching any worker.
  writeJson(file, state)
  try {
    const session = store.createSession({ workspaceId: parent.workspaceId, ...target }, config.writeDir)
    child.sessionId = session.id
    writeJson(file, state)
    store.updateSession(session.id, { mode: target.mode, parentSessionId: parent.id, parentRunId: context.runId,
      rootSessionId: parent.rootSessionId || parent.id, delegationMode: target.mode }, config.writeDir)
    require('./Harness').spawnRun(session.id, target.mode === 'plan' ? 'plan' : 'run', {
      mode: target.mode, prompt: args.task,
      onPrepared: (run) => { child.runId = run.id; writeJson(file, state) },
    })
  } catch (err) {
    child.error = err.message
    writeJson(file, state)
  }
  return describe(child)
})

const ownedChild = (context, args) => {
  const state = stateFor(context)
  const child = Object.values(state.children).find(item => item.sessionId === args.sessionId && item.runId === args.runId)
  if (!child || !child.sessionId || !child.runId) fail('Child does not belong to this parent run')
  return child
}
const status = (context, args) => describe(ownedChild(context, args))
const stop = (context, args) => {
  const child = ownedChild(context, args)
  if (!describe(child).done) require('./Harness').stop(child.sessionId)
  return describe(child)
}
const wait = async (context, args) => {
  const seconds = args.seconds === undefined ? 20 : args.seconds
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 20) fail('seconds must be between 0 and 20')
  const deadline = Date.now() + seconds * 1000
  while (true) {
    const result = status(context, args)
    if (result.done || Date.now() >= deadline) return result
    await new Promise(resolve => setTimeout(resolve, Math.min(250, deadline - Date.now())))
  }
}

const stopChildren = (sessionId, runId) => {
  if (!fs.existsSync(fileFor(sessionId, runId))) return
  withLock(sessionId, runId, (file) => {
    const state = readJson(file)
    if (!state) return
    writeJson(file, { ...state, closed: true })
    for (const child of Object.values(state.children)) {
      if (child.sessionId && !describe(child).done) require('./Harness').stop(child.sessionId)
    }
  })
}

// Periodic recovery also covers crashes before a daemon wrote its pid file.
const recover = async () => {
  const sessions = await store.listSessionsAsync(config.writeDir)
  for (const session of sessions) {
    if (session.parentRunId && !parentActive(session.parentSessionId, session.parentRunId)) {
      if (['running', 'awaiting_input'].includes(session.status)) require('./Harness').stop(session.id)
    }
    if (!session.parentRunId) {
      for (const run of store.listRuns(session.id, config.writeDir)) {
        if (!parentActive(session.id, run.id)) stopChildren(session.id, run.id)
      }
    }
  }
}

const childrenFor = (sessionId) => store.listRuns(sessionId, config.writeDir).flatMap(run => {
  const state = readJson(fileFor(sessionId, run.id))
  return Object.values(state?.children || {}).map(child => ({ ...describe(child), parentRunId: run.id }))
})

const assertChildRun = (session, mode) => {
  if (!session?.parentRunId) return
  if (!parentActive(session.parentSessionId, session.parentRunId)) fail('The parent run has ended; this child cannot start another run')
  const rank = { agent: 0, plan: 1, ask: 2 }
  if (!Object.hasOwn(rank, mode) || rank[mode] < rank[session.delegationMode]) fail('Child permissions cannot be broadened')
}

const guidance = (provider, child = false) => [
  child ? 'You are a harness child. Do not delegate or spawn other agents.' :
    'Use harness_agents spawn/status/wait/stop for all delegation. Children default to Cursor grok-4.7. Supply a stable retryKey for each task; reuse it only to retry the same task. Wait for needed results before finishing, since unfinished children stop when you finish.',
  'All agents share the existing project directory. Assign separate file ownership for parallel edits. Do not create worktrees.',
  provider === 'grok' ? 'Native spawning cannot be fully blocked by this provider. Do not use native spawning.' : '',
].filter(Boolean).join('\n')

module.exports = { childrenFor, assertChildRun, open, authenticate, spawn, status, wait, stop, stopChildren, recover, parentActive, guidance, describe }
