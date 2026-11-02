const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')
const config = require('../config')
const paths = require('../store/paths')
const store = require('../store/sessionStore')
const { readJson, readJsonAsync, writeJson } = require('../store/jsonFile')
const locks = require('../store/sessionLock')
const questions = require('../store/questionStore')
const registry = require('../registry')

const fileFor = (sessionId, runId) => path.join(paths.sessionDir(sessionId, config.writeDir), 'delegation', `${runId}.json`)
const credentialFile = (hash) => path.join(config.writeDir, 'delegation-credentials', `${hash}.json`)
const hashOf = (value) => crypto.createHash('sha256').update(value).digest('hex')
const fail = (message) => { throw Object.assign(new Error(message), { status: 403 }) }
const heldRecordLocks = new Set()
const withLock = (sessionId, runId, fn, { nonblock = false } = {}) => {
  const file = fileFor(sessionId, runId)
  if (heldRecordLocks.has(file)) return fn(file)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const fd = fs.openSync(`${file}.lock`, 'a', 0o600)
  try {
    const result = spawnSync('flock', [nonblock ? '--nonblock' : '--wait=1', '3'], { stdio: ['ignore', 'pipe', 'pipe', fd] })
    if (result.error || result.status !== 0) throw Object.assign(new Error('Child records are busy; retry shortly'), { status: result.error ? 500 : 409 })
    heldRecordLocks.add(file)
    return fn(file)
  } finally { heldRecordLocks.delete(file); fs.closeSync(fd) }
}

const pendingDir = () => path.join(config.writeDir, 'delegation-pending')
const pendingFile = (sessionId, runId) => path.join(pendingDir(), sessionId, `${runId}.json`)
const trackRun = (sessionId, runId) => {
  const file = pendingFile(sessionId, runId)
  if (!fs.existsSync(file)) writeJson(file, { sessionId, runId })
}
const listNames = (dir) => {
  try { return fs.readdirSync(dir) }
  catch (err) { if (err.code === 'ENOENT') return []; throw err }
}
const listNamesAsync = async (dir) => {
  try { return await fs.promises.readdir(dir) }
  catch (err) { if (err.code === 'ENOENT') return []; throw err }
}
const pendingStatesFor = (sessionId) => listNames(path.join(pendingDir(), sessionId))
  .filter(name => name.endsWith('.json'))
  .map(name => ({ runId: name.slice(0, -5), state: readJson(fileFor(sessionId, name.slice(0, -5))) }))

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
  // Persist discoverability before state: a crash must not orphan child work.
  trackRun(session.id, runId)
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
  if (Object.hasOwn(args, 'provider')) fail('Choose a model; the provider is selected automatically')
  if (args.model !== undefined && (typeof args.model !== 'string' || !args.model.trim())) fail('model must be a nonempty model ID or inherit')
  const model = args.model === undefined || args.model === 'inherit' ? parent.model : args.model
  // Inheritance keeps the provider/model pair together; only a different model needs routing.
  let provider = parent.provider
  if (model !== parent.model) {
    const models = readJson(path.join(__dirname, '..', 'agents', 'models.json'), {})
    const candidates = require('../agents/driver').listProviders().filter(id => models[id]?.some(item => item.id === model))
    if (!candidates.length) fail(`Unknown model: ${model}`)
    provider = candidates.includes(parent.provider) ? parent.provider : candidates[0]
  }
  const mode = args.mode || state.baseMode
  const rank = { agent: 0, plan: 1, ask: 2 }
  if (!Object.hasOwn(rank, mode) || rank[mode] < rank[state.baseMode]) fail('Child mode must be at least as restrictive as the parent base mode')
  if (!require('../agents/driver').listProviders().includes(provider)) fail(`Unknown provider: ${provider}`)
  registry.requireMode(registry.sessionWorkspace(parent), mode, { provider })
  if (provider === 'grok' && mode !== 'agent') fail('Grok restricted child modes cannot be enforced by its current transport; use Cursor, Codex, or Claude')
  // Provider-specific boundaries cannot safely be translated to another provider.
  if (parent.provider === 'codex' && ((parent.codex?.sandbox || 'danger-full-access') !== 'danger-full-access' || (parent.codex?.approvalPolicy || 'never') !== 'never') && provider !== 'codex') {
    fail('This parent has Codex sandbox or approval restrictions; use inherit or a model available through Codex')
  }
  if (parent.provider === 'claude' && parent.claude?.permissionMode && parent.claude.permissionMode !== 'bypassPermissions' && provider !== 'claude') {
    fail('This parent has Claude approval restrictions; use inherit or a model available through Claude')
  }
  return { provider, model, mode,
    ...(provider === 'codex' && parent.provider === 'codex' ? { codex: { ...parent.codex, ...(model !== parent.model ? { reasoningEffort: null } : {}) } } : {}),
    ...(provider === 'claude' && parent.provider === 'claude' ? { claude: parent.claude } : {}),
    ...(provider === 'grok' && parent.provider === 'grok' ? { grok: parent.grok } : {}),
  }
}

const describeRecords = (child, session, run, pendingQuestions) => {
  const done = Boolean(run?.endedAt || child.error || child.cancelRequestedAt)
  return {
    sessionId: child.sessionId || null, runId: child.runId || null,
    workspaceId: session?.workspaceId, parentRunId: session?.parentRunId,
    transcriptLink: session ? `/?workspace=${encodeURIComponent(session.workspaceId)}&session=${encodeURIComponent(session.id)}` : null,
    state: child.cancelRequestedAt ? 'cancelled' : child.error ? 'error' : done ? run.status : session?.status === 'awaiting_input' ? 'awaiting_input' : run?.status || 'starting',
    done, provider: session?.provider, model: session?.model, mode: run?.mode,
    pendingQuestions: pendingQuestions.filter(q => q.runId === child.runId && q.status === 'pending'),
    error: child.error || run?.error || null,
    nativeSpawningBlocked: session ? session.provider !== 'grok' : null,
    ...(session?.provider === 'grok' ? { warning: 'Native spawning cannot be fully blocked by Grok; the child is instructed not to spawn.' } : {}),
    usage: run?.usage ?? null, normalizedUsage: store.normalizeUsage(run?.usage, session?.provider),
    durationMs: run?.durationMs || (run ? Math.max(0, (run.endedAt || Date.now()) - run.startedAt) : 0),
    ...(done ? { finalResponse: child.cancelRequestedAt ? null : run?.result ?? null } : {}),
  }
}
const describe = (child) => describeRecords(child,
  child.sessionId && store.loadSession(child.sessionId, config.writeDir),
  child.sessionId && child.runId && store.loadRun(child.sessionId, child.runId, config.writeDir),
  child.sessionId ? questions.listQuestions(child.sessionId, config.writeDir) : [])
const describeAsync = async (child) => {
  const [session, run, pendingQuestions] = await Promise.all([
    child.sessionId ? store.loadSessionAsync(child.sessionId, config.writeDir) : null,
    child.sessionId && child.runId ? readJsonAsync(paths.runFile(child.sessionId, child.runId, config.writeDir)) : null,
    child.sessionId ? questions.listQuestionsAsync(child.sessionId, config.writeDir) : [],
  ])
  return describeRecords(child, session, run, pendingQuestions)
}

const spawn = (context, args) => withLock(context.sessionId, context.runId, (file) => {
  const state = stateFor(context)
  if (typeof args.task !== 'string' || !args.task.trim()) fail('task must be a nonempty string')
  if (typeof args.retryKey !== 'string' || !args.retryKey.trim() || args.retryKey.length > 256) fail('retryKey is required (1–256 characters)')
  const key = hashOf(args.retryKey)
  const requestHash = hashOf(JSON.stringify([args.task, null, args.model || null, args.mode || null]))
  const prior = state.children[key]
  if (prior) {
    if (prior.requestHash !== requestHash) fail('retryKey was already used for a different request')
    if (!prior.runId && !prior.error) {
      prior.error = 'Spawn was interrupted before launch; this retry key remains reserved. Use a new key for a new attempt.'
      writeJson(file, state)
    }
    return describe(prior)
  }
  for (const child of Object.values(state.children)) {
    if (!child.runId && !child.error) child.error = 'Spawn was interrupted before launch; retry with a new key.'
  }
  writeJson(file, state)
  if (Object.values(state.children).filter(child => !describe(child).done).length >= 4) fail('Child limit reached: at most four active children per parent run')
  const parent = store.loadSession(context.sessionId, config.writeDir)
  const target = targetFor(parent, state, args)
  const child = { requestHash, task: args.task, parentSessionId: parent.id, parentRunId: context.runId, resultId: `${context.runId}:${key}`, createdAt: Date.now() }
  state.children[key] = child
  // Reserve the key durably before creating a session or launching any worker.
  writeJson(file, state)
  try {
    const workspaceId = parent.workspaceId || require('../store/workspaceStore').findWorkspaceByCwd(parent.cwd, config.writeDir)?.id
    const session = store.createSession({ workspaceId, ...target }, config.writeDir)
    child.sessionId = session.id
    writeJson(file, state)
    store.updateSession(session.id, { mode: target.mode, parentSessionId: parent.id, parentRunId: context.runId,
      rootSessionId: parent.rootSessionId || parent.id, delegationMode: target.mode }, config.writeDir)
    if (store.loadSession(parent.id, config.writeDir)?.archived) {
      store.updateSession(session.id, { archived: true }, config.writeDir)
    }
    require('./Harness').spawnRun(session.id, target.mode === 'plan' ? 'plan' : 'run', {
      mode: target.mode, prompt: args.task, autoName: true,
      onPrepared: (run) => { child.runId = run.id; writeJson(file, state) },
    })
  } catch (err) {
    child.error = err.message
    writeJson(file, state)
  }
  return describe(child)
})

const statesFor = (sessionId) => listNames(path.join(paths.sessionDir(sessionId, config.writeDir), 'delegation'))
  .filter(name => name.endsWith('.json'))
  .map(name => ({ runId: name.slice(0, -5), state: readJson(fileFor(sessionId, name.slice(0, -5))) }))
  .filter(item => item.state)

const ownedChild = (context, args) => {
  stateFor(context)
  const child = statesFor(context.sessionId).flatMap(({ state }) => Object.values(state.children || {}))
    .find(item => item.sessionId === args.sessionId && item.runId === args.runId)
  if (!child || !child.sessionId || !child.runId) fail('Child does not belong to this parent session')
  return child
}
const status = (context, args) => describe(ownedChild(context, args))
const cancelChild = (sessionId) => {
  const session = store.loadSession(sessionId, config.writeDir)
  if (!session?.parentRunId) return
  withLock(session.parentSessionId, session.parentRunId, (file) => {
    const state = readJson(file)
    if (!state) return
    for (const child of Object.values(state.children || {})) {
      if (child.sessionId === sessionId && !child.result && !describe(child).done) child.cancelRequestedAt = Date.now()
    }
    writeJson(file, state)
  })
}
const stop = (context, args) => {
  const child = ownedChild(context, args)
  if (!describe(child).done) {
    cancelChild(child.sessionId)
    require('./Harness').stop(child.sessionId)
  }
  return status(context, args)
}
// Waiting is a snapshot: automatic delivery resumes the parent when results arrive.
const wait = async (context, args) => {
  if (args.seconds !== undefined && (!Number.isFinite(args.seconds) || args.seconds < 0 || args.seconds > 20)) fail('seconds must be between 0 and 20')
  return status(context, args)
}

const closeState = (state) => {
  if (state.credentialHash) fs.rmSync(credentialFile(state.credentialHash), { force: true })
  state.closed = true
  state.closedAt ||= Date.now()
}
const closeRun = (sessionId, runId) => {
  const previous = readJson(fileFor(sessionId, runId))
  if (!previous || previous.closed) return
  withLock(sessionId, runId, (file) => {
    const state = readJson(file)
    if (!state || state.closed) return
    trackRun(sessionId, runId)
    closeState(state)
    writeJson(file, state)
  })
}
const parentAllowed = (sessionId, runId) => {
  const parent = store.loadSession(sessionId, config.writeDir)
  const state = readJson(fileFor(sessionId, runId))
  return Boolean(parent && !parent.parentRunId && state && !state.cancelledAt && store.loadRun(sessionId, runId, config.writeDir))
}

const stopChildren = (sessionId, runId) => {
  if (!fs.existsSync(fileFor(sessionId, runId))) return
  // The scheduler uses this same lock, so stop cannot race a new delivery batch.
  withLock(sessionId, 'delivery', () => {
    const sessions = []
    withLock(sessionId, runId, (file) => {
      const state = readJson(file)
      if (!state) return
      trackRun(sessionId, runId)
      closeState(state)
      state.cancelledAt ||= Date.now()
      for (const child of Object.values(state.children || {})) {
        child.delivery = { ...child.delivery, status: 'suppressed', suppressedAt: Date.now() }
        if (!describe(child).done) {
          child.cancelRequestedAt ||= Date.now()
          if (child.sessionId) sessions.push(child.sessionId)
        }
      }
      writeJson(file, state)
    })
    // Release the record lock before stop calls back into cancelChild.
    for (const childSessionId of sessions) require('./Harness').stop(childSessionId)
  })
}

const retryableDelivery = (child) => {
  if (child.delivery?.status !== 'delivered' || !child.delivery.runId) return false
  const run = store.loadRun(child.parentSessionId, child.delivery.runId, config.writeDir)
  if (!run?.delegationDelivery || run.pid || run.providerRunId ||
    !['running', 'interrupted', 'disconnected'].includes(run.status)) return false
  // A later manual turn supersedes an old launch retry, matching delivery's
  // latest-turn rule. This history read is only for the rare unstarted receipt.
  return store.listRuns(child.parentSessionId, config.writeDir).at(-1)?.id === run.id
}
const settled = (state) => state?.closed && Object.values(state.children || {}).every(child => {
  if (!['delivered', 'suppressed'].includes(child.delivery?.status) || retryableDelivery(child)) return false
  return !child.sessionId || !child.runId || Boolean(store.loadRun(child.sessionId, child.runId, config.writeDir)?.endedAt)
})
const maintenanceLock = (sessionId, runId, fn) => withLock(sessionId, runId, fn, { nonblock: true })
let seeded = false
let recovering = false
const seedPending = async () => {
  if (seeded) return
  // Upgrade old records once per worker start, including archived parents.
  for (const session of require('../store/sessionIndex').query({ includeArchived: true })) {
    if (session.parentRunId) continue
    for (const { runId } of statesFor(session.id)) {
      try {
        maintenanceLock(session.id, runId, file => {
          const state = readJson(file)
          if (state && !settled(state)) trackRun(session.id, runId)
        })
      } catch (err) {
        if (err.status !== 409) throw err
        // The live writer owns its record; keeping a marker is safe and idempotent.
        trackRun(session.id, runId)
      }
    }
    await new Promise(resolve => setImmediate(resolve))
  }
  seeded = true
}
const recoverIdleOwner = (session) => {
  const owner = readJson(paths.daemonPid(session.id, config.writeDir))
  if (locks.ownerAlive(owner)) return
  let lock
  try {
    lock = locks.acquire(session.id, config.writeDir)
    store.recoverSession(session.id, config.writeDir)
  } catch (err) { if (err.status !== 409) throw err }
  finally { lock?.release() }
}
const recoverChild = (child, state) => {
  if (!child.sessionId || !child.runId) return
  const run = store.loadRun(child.sessionId, child.runId, config.writeDir)
  if (!run || run.endedAt) return
  const session = store.loadSession(child.sessionId, config.writeDir)
  if (!session) return
  if (state.cancelledAt && !session.stopRequestedAt) require('./Harness').stop(session.id)
  const stopAt = session.stopRequestedAt || child.cancelRequestedAt || state.cancelledAt
  if (stopAt && Date.now() - stopAt > 10000) {
    const owner = readJson(paths.daemonPid(session.id, config.writeDir))
    if (locks.ownerAlive(owner)) require('./process').signal(-owner.pid, 'SIGKILL')
  }
  recoverIdleOwner(session)
}

// The queue is independent of archive/idle state: later messages stay cheap,
// while child results and interrupted deliveries survive server restarts.
const recover = async () => {
  if (recovering) return
  recovering = true
  try {
    await seedPending()
    for (const session of require('../store/sessionIndex').query({ statuses: ['running', 'awaiting_input'], includeArchived: true })) {
      recoverIdleOwner(session)
      await new Promise(resolve => setImmediate(resolve))
    }
    for (const sessionId of listNames(pendingDir())) {
      try {
        if (!store.loadSession(sessionId, config.writeDir)) continue
        for (const { runId, state } of pendingStatesFor(sessionId)) {
          if (!state) continue
          const run = store.loadRun(sessionId, runId, config.writeDir)
          if (!state.closed && run?.endedAt) maintenanceLock(sessionId, runId, file => {
            const current = readJson(file)
            if (!current || current.closed) return
            closeState(current)
            writeJson(file, current)
          })
          for (const child of Object.values(state.children || {})) recoverChild(child, state)
        }
        require('./delegationDelivery').recoverParent(sessionId, {
          withLock: maintenanceLock, statesFor: pendingStatesFor, describe, retryableDelivery,
        })
        for (const { runId } of pendingStatesFor(sessionId)) maintenanceLock(sessionId, runId, file => {
          const state = readJson(file)
          if (!state || settled(state)) fs.rmSync(pendingFile(sessionId, runId), { force: true })
        })
        try { fs.rmdirSync(path.join(pendingDir(), sessionId)) }
        catch (err) { if (!['ENOENT', 'ENOTEMPTY'].includes(err.code)) throw err }
      } catch (err) { if (err.status !== 409) throw err }
      await new Promise(resolve => setImmediate(resolve))
    }
  } finally { recovering = false }
}

const childrenFor = (sessionId) => statesFor(sessionId).flatMap(({ runId, state }) =>
  Object.values(state.children || {}).map(child => ({ ...describe(child), parentRunId: runId })))
const childrenForAsync = async (sessionId) => {
  const names = await listNamesAsync(path.join(paths.sessionDir(sessionId, config.writeDir), 'delegation'))
  const children = await Promise.all(names.filter(name => name.endsWith('.json')).map(async name => {
    const runId = name.slice(0, -5)
    const state = await readJsonAsync(fileFor(sessionId, runId))
    return Promise.all(Object.values(state?.children || {}).map(async child => ({ ...await describeAsync(child), parentRunId: runId })))
  }))
  return children.flat()
}

const assertChildRun = (session, mode) => {
  if (!session?.parentRunId) return
  if (!parentAllowed(session.parentSessionId, session.parentRunId)) fail('The parent cancelled this child; it cannot start another run')
  const rank = { agent: 0, plan: 1, ask: 2 }
  if (!Object.hasOwn(rank, mode) || rank[mode] < rank[session.delegationMode]) fail('Child permissions cannot be broadened')
}

const guidance = (provider, child = false) => require('../prompts').text(child ? 'delegationChild' : 'delegationParent', provider)

const withDeliveryLock = (sessionId, fn) => withLock(sessionId, 'delivery', fn)

module.exports = { withDeliveryLock, childrenFor, childrenForAsync, assertChildRun, open, authenticate, spawn, status, wait, stop, stopChildren, closeRun, cancelChild, recover, parentActive, parentAllowed, guidance, describe }
