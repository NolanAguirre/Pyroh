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
const { getUiSettings } = require('../store/uiSettings')
const { isDelegatedChild } = require('../store/delegationBoundary')

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

const activeOwner = (session, run, owner) => Boolean(session && ['running', 'awaiting_input'].includes(session.status) &&
  run?.status === 'running' && !run.endedAt && owner?.runId === run.id && locks.ownerAlive(owner))

const workflowAllowed = (sessionId, runId) => {
  const session = store.loadSession(sessionId, config.writeDir)
  const run = store.loadRun(sessionId, runId, config.writeDir)
  const owner = readJson(paths.daemonPid(sessionId, config.writeDir))
  return Boolean(run?.workflow && !readJson(fileFor(sessionId, runId))?.cancelledAt && activeOwner(session, run, owner))
}

// Depth limits govern new children, not completion of work already accepted.
const canDelegate = (session) => Boolean(session && !session.stopRequestedAt && session.status !== 'stopped' &&
  (!session.parentRunId || session.delegationDetached || parentAllowed(session.parentSessionId, session.parentRunId)))
const canSpawn = (session) => canDelegate(session) && session.depth < getUiSettings(config.writeDir).maxSubagentDepth
const assertSpawnDepth = (session) => {
  const maxDepth = getUiSettings(config.writeDir).maxSubagentDepth
  if (!Number.isInteger(session?.depth) || session.depth >= maxDepth) {
    fail(`Subagent depth limit reached: parent depth ${session?.depth ?? 'unknown'}, maximum child depth ${maxDepth}`)
  }
}

const parentActive = (sessionId, runId) => {
  const session = store.loadSession(sessionId, config.writeDir)
  const run = store.loadRun(sessionId, runId, config.writeDir)
  const owner = readJson(paths.daemonPid(sessionId, config.writeDir))
  return canDelegate(session) && activeOwner(session, run, owner)
}

const open = (session, runId, baseMode) => withLock(session.id, runId, (file) => {
  if (!parentActive(session.id, runId)) fail('Delegation requires an active parent run that may delegate')
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
  const parentModel = require('../prompt/context').sessionModel(parent)
  const model = args.model === undefined || args.model === 'inherit' ? parentModel : args.model
  // Inheritance keeps the provider/model pair together; only a different model needs routing.
  let provider = parent.provider
  if (model !== parentModel) {
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
    ...(provider === 'codex' && parent.provider === 'codex' ? { codex: { ...parent.codex, ...(model !== parentModel ? { reasoningEffort: null } : {}) } } : {}),
    ...(provider === 'claude' && parent.provider === 'claude' ? { claude: parent.claude } : {}),
    ...(provider === 'grok' && parent.provider === 'grok' ? { grok: parent.grok } : {}),
  }
}

const describeRecords = (child, session, run, pendingQuestions, runs = run ? [run] : []) => {
  const detached = session?.delegationDetached
  const cancelled = Boolean(child.cancelRequestedAt || (detached ? detached.cancelled : session?.stopRequestedAt))
  const waiting = Boolean(session && !detached && hasPendingChildren(session.id))
  const done = Boolean(detached || ((cancelled || child.error || run?.endedAt) && !waiting && runs.every(item => item.endedAt)))
  const normalized = runs.map(item => store.normalizeUsage(item.usage, session?.provider)).filter(Boolean)
  const normalizedUsage = normalized.length ? normalized.reduce((total, usage) => {
    for (const [key, value] of Object.entries(usage)) total[key] = (total[key] || 0) + value
    return total
  }, {}) : null
  return {
    sessionId: child.sessionId || null, runId: child.runId || null,
    latestRunId: run?.id || null,
    depth: session?.depth ?? null, lineage: session?.lineage ?? [],
    childKind: session?.childKind || child.childKind || 'delegation',
    workflow: session?.workflow || child.workflow || null, name: session?.name || null,
    workspaceId: session?.workspaceId, parentRunId: session?.parentRunId,
    transcriptLink: session ? `/?workspace=${encodeURIComponent(session.workspaceId)}&session=${encodeURIComponent(session.id)}` : null,
    state: cancelled ? 'cancelled' : child.error ? 'error' : done ? run?.status || 'detached' : session?.status === 'awaiting_input' ? 'awaiting_input' : waiting && run?.endedAt ? 'subagent' : run?.status || 'starting',
    done, dontReturn: child.dontReturn === true, provider: session?.provider, model: session?.model, mode: run?.mode,
    pendingQuestions: pendingQuestions.filter(q => q.runId === run?.id && q.status === 'pending'),
    error: child.error || run?.error || null,
    nativeSpawningBlocked: session ? session.provider !== 'grok' : null,
    ...(session?.provider === 'grok' ? { warning: 'Native spawning cannot be fully blocked by Grok; the child is instructed to use only harness delegation.' } : {}),
    usage: runs.length > 1 ? normalizedUsage : run?.usage ?? null, normalizedUsage,
    durationMs: runs.reduce((total, item) => total + (item.durationMs || Math.max(0, (item.endedAt || Date.now()) - item.startedAt)), 0),
    ...(done ? { finalResponse: cancelled ? null : run?.result ?? null } : {}),
  }
}
const delegatedRuns = (session, runs) => session?.delegationDetached
  ? runs.filter(run => session.delegationDetached.runIds.includes(run.id)) : runs
const describe = (child) => {
  const session = child.sessionId && store.loadSession(child.sessionId, config.writeDir)
  const runs = delegatedRuns(session, child.sessionId && child.runId ? store.listRuns(child.sessionId, config.writeDir) : [])
  return describeRecords(child, session, runs.at(-1),
    child.sessionId ? questions.listQuestions(child.sessionId, config.writeDir) : [], runs)
}
const describeAsync = async (child) => {
  const [session, runs, pendingQuestions] = await Promise.all([
    child.sessionId ? store.loadSessionAsync(child.sessionId, config.writeDir) : null,
    child.sessionId && child.runId ? store.listRunsAsync(child.sessionId, config.writeDir) : [],
    child.sessionId ? questions.listQuestionsAsync(child.sessionId, config.writeDir) : [],
  ])
  const originalRuns = delegatedRuns(session, runs)
  return describeRecords(child, session, originalRuns.at(-1), pendingQuestions, originalRuns)
}

const spawn = (context, args) => withLock(context.sessionId, context.runId, (file) => {
  const state = stateFor(context)
  if (typeof args.task !== 'string' || !args.task.trim()) fail('task must be a nonempty string')
  if (typeof args.retryKey !== 'string' || !args.retryKey.trim() || args.retryKey.length > 256) fail('retryKey is required (1–256 characters)')
  if (args.dontReturn !== undefined && typeof args.dontReturn !== 'boolean') fail('dontReturn must be a boolean')
  const dontReturn = args.dontReturn === true
  const key = hashOf(args.retryKey)
  const requestHash = hashOf(JSON.stringify([args.task, null, args.model || null, args.mode || null]))
  const prior = state.children[key]
  if (prior) {
    if (prior.requestHash !== requestHash || (prior.dontReturn === true) !== dontReturn) fail('retryKey was already used for a different request')
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
  if (statesFor(context.sessionId).flatMap(({ state: item }) => Object.values(item.children || {}))
    .filter(child => !describe(child).done || childHasWork(child)).length >= 4) fail('Child limit reached: at most four active children per parent session')
  const parent = store.loadSession(context.sessionId, config.writeDir)
  assertSpawnDepth(parent)
  const target = targetFor(parent, state, args)
  const child = { childKind: 'delegation', requestHash, task: args.task, dontReturn, parentSessionId: parent.id, parentRunId: context.runId, resultId: `${context.runId}:${key}`, createdAt: Date.now(),
    ...(dontReturn ? { delivery: { status: 'suppressed', suppressedAt: Date.now() } } : {}),
  }
  state.children[key] = child
  // Reserve the key durably before creating a session or launching any worker.
  writeJson(file, state)
  try {
    const workspaceId = parent.workspaceId || require('../store/workspaceStore').findWorkspaceByCwd(parent.cwd, config.writeDir)?.id
    const session = store.createSession({ workspaceId, ...target }, config.writeDir)
    child.sessionId = session.id
    writeJson(file, state)
    store.updateSession(session.id, { mode: target.mode, parentSessionId: parent.id, parentRunId: context.runId,
      rootSessionId: parent.rootSessionId || parent.id, childKind: 'delegation', delegationMode: target.mode }, config.writeDir)
    if (store.loadSession(parent.id, config.writeDir)?.archived) {
      store.updateSession(session.id, { archived: true }, config.writeDir)
    }
    // Settings may have changed since this run opened its delegation tools.
    assertSpawnDepth(store.loadSession(parent.id, config.writeDir))
    require('./Harness').spawnRun(session.id, target.mode === 'plan' ? 'plan' : 'run', {
      mode: target.mode, prompt: args.task, autoName: true,
      promptProvenance: require('../prompt/provenance').agentPrompt(args.task, 'Task from parent agent'),
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
  if (!isDelegatedChild(session)) return
  withLock(session.parentSessionId, session.parentRunId, (file) => {
    if (!isDelegatedChild(store.loadSession(sessionId, config.writeDir))) return
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
  if (!describe(child).done || childHasWork(child)) {
    cancelChild(child.sessionId)
    require('./Harness').stop(child.sessionId, { delegated: true })
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
  const run = store.loadRun(sessionId, runId, config.writeDir)
  if (run?.workflow) return canDelegate(parent) && workflowAllowed(sessionId, runId)
  const state = readJson(fileFor(sessionId, runId))
  return Boolean(canDelegate(parent) && state && !state.cancelledAt && run)
}

const childHasWork = (child) => Boolean(child.sessionId && !store.loadSession(child.sessionId, config.writeDir)?.delegationDetached && (
  store.listRuns(child.sessionId, config.writeDir).some(run => !run.endedAt) || hasPendingChildren(child.sessionId)))

const workflowChildren = (sessionId) => {
  const parent = store.loadSession(sessionId, config.writeDir)
  // Durable controller references cover an index write missed under contention.
  const ids = new Set(store.listRuns(sessionId, config.writeDir).flatMap(run => run.workflowChildren || []))
  for (const session of require('../store/sessionIndex').query({ workspaceId: parent?.workspaceId, includeArchived: true })) {
    if (session.parentSessionId === sessionId && session.childKind === 'workflow') ids.add(session.id)
  }
  return [...ids].map(id => store.loadSession(id, config.writeDir))
    .filter(session => session?.parentSessionId === sessionId && session.childKind === 'workflow')
}

const stopChildren = (sessionId, runId) => {
  const workflowSessions = workflowChildren(sessionId).filter(session => session.parentRunId === runId)
  if (!fs.existsSync(fileFor(sessionId, runId)) && !workflowSessions.length &&
    !store.loadRun(sessionId, runId, config.writeDir)?.workflow) return
  // The scheduler uses this same lock, so stop cannot race a new delivery batch.
  withLock(sessionId, 'delivery', () => {
    const sessions = new Set(workflowSessions.filter(session =>
      !store.listRuns(session.id, config.writeDir).at(-1)?.endedAt ||
      ['running', 'awaiting_input'].includes(session.status) || hasPendingChildren(session.id))
      .map(session => session.id))
    withLock(sessionId, runId, (file) => {
      const state = readJson(file) || { sessionId, runId, children: {} }
      trackRun(sessionId, runId)
      closeState(state)
      state.cancelledAt ||= Date.now()
      for (const child of Object.values(state.children || {})) {
        child.delivery = { ...child.delivery, status: 'suppressed', suppressedAt: Date.now() }
        if (!describe(child).done || childHasWork(child)) {
          child.cancelRequestedAt ||= Date.now()
          if (child.sessionId) sessions.add(child.sessionId)
        }
      }
      writeJson(file, state)
    })
    // Release the record lock before stop calls back into cancelChild.
    for (const childSessionId of sessions) require('./Harness').stop(childSessionId, { delegated: true })
  })
}

const retryableDelivery = (child) => {
  if (child.dontReturn === true) return false
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
  return !childHasWork(child)
})
const maintenanceLock = (sessionId, runId, fn) => withLock(sessionId, runId, fn, { nonblock: true })
let seeded = false
let recovering = false
const seedPending = async () => {
  if (seeded) return
  // Upgrade old records once per worker start, including archived parents.
  for (const session of require('../store/sessionIndex').query({ includeArchived: true })) {
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
  const session = store.loadSession(child.sessionId, config.writeDir)
  if (!session || session.delegationDetached) return
  if ((state.cancelledAt || child.cancelRequestedAt) && !session.stopRequestedAt) require('./Harness').stop(session.id, { delegated: true })
  const runs = store.listRuns(child.sessionId, config.writeDir)
  if (!runs.some(run => !run.endedAt)) return
  const stopAt = session.stopRequestedAt || child.cancelRequestedAt || state.cancelledAt
  if (stopAt && Date.now() - stopAt > 10000) {
    withDeliveryLock(session.id, () => {
      if (store.loadSession(session.id, config.writeDir)?.delegationDetached) return
      const owner = readJson(paths.daemonPid(session.id, config.writeDir))
      if (locks.ownerAlive(owner)) require('./process').signal(-owner.pid, 'SIGKILL')
    })
  }
  recoverIdleOwner(session)
}
const settleSubagentParent = (sessionId) => {
  if (store.loadSession(sessionId, config.writeDir)?.status !== 'subagent' || hasPendingChildren(sessionId)) return
  let lock
  try {
    lock = locks.acquire(sessionId, config.writeDir)
    if (store.loadSession(sessionId, config.writeDir)?.status === 'subagent' && !hasPendingChildren(sessionId)) {
      store.updateSession(sessionId, { status: 'idle' }, config.writeDir)
    }
  } catch (err) { if (err.status !== 409) throw err }
  finally { lock?.release() }
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
        settleSubagentParent(sessionId)
        try { fs.rmdirSync(path.join(pendingDir(), sessionId)) }
        catch (err) { if (!['ENOENT', 'ENOTEMPTY'].includes(err.code)) throw err }
      } catch (err) { if (err.status !== 409) throw err }
      await new Promise(resolve => setImmediate(resolve))
    }
  } finally { recovering = false }
}

const hasPendingChildren = (sessionId) => statesFor(sessionId).some(({ state }) =>
  Object.values(state.children || {}).some(child => child.childKind !== 'workflow' &&
    (!['delivered', 'suppressed'].includes(child.delivery?.status) || retryableDelivery(child) ||
      childHasWork(child) || !describe(child).done)))

const workflowDescription = (session, run, pendingQuestions) => {
  const description = describeRecords({
    sessionId: session.id, runId: run?.id, childKind: 'workflow',
    ...(session.stopRequestedAt ? { cancelRequestedAt: session.stopRequestedAt } : {}),
  }, session, run, pendingQuestions)
  return !session.stopRequestedAt && hasPendingChildren(session.id)
    ? { ...description, done: false, state: 'running', finalResponse: undefined } : description
}

const childrenFor = (sessionId) => [
  ...statesFor(sessionId).flatMap(({ runId, state }) =>
    Object.values(state.children || {}).map(child => ({ ...describe(child), parentRunId: runId }))),
  ...workflowChildren(sessionId).map(session => workflowDescription(session,
    store.listRuns(session.id, config.writeDir).at(-1), questions.listQuestions(session.id, config.writeDir))),
]
const childrenForAsync = async (sessionId) => {
  const names = await listNamesAsync(path.join(paths.sessionDir(sessionId, config.writeDir), 'delegation'))
  const children = await Promise.all(names.filter(name => name.endsWith('.json')).map(async name => {
    const runId = name.slice(0, -5)
    const state = await readJsonAsync(fileFor(sessionId, runId))
    return Promise.all(Object.values(state?.children || {}).map(async child => ({ ...await describeAsync(child), parentRunId: runId })))
  }))
  await require('../store/sessionIndex').whenReady()
  const workflows = await Promise.all(workflowChildren(sessionId).map(async session => {
    const [runs, pendingQuestions] = await Promise.all([
      store.listRunsAsync(session.id, config.writeDir), questions.listQuestionsAsync(session.id, config.writeDir),
    ])
    return workflowDescription(session, runs.at(-1), pendingQuestions)
  }))
  return [...children.flat(), ...workflows]
}

const assertChildRun = (session, mode, { userFollowup = false } = {}) => {
  if (!session?.parentRunId || session.delegationDetached) return
  if (userFollowup && session.childKind !== 'workflow' && store.listRuns(session.id, config.writeDir).length) return
  if (session.stopRequestedAt || session.status === 'stopped') fail('This child was stopped; it cannot start another run')
  if (!parentAllowed(session.parentSessionId, session.parentRunId)) fail('The parent cancelled this child; it cannot start another run')
  const rank = { agent: 0, plan: 1, ask: 2 }
  const baseMode = session.childKind === 'workflow' ? session.mode : session.delegationMode
  if (!Object.hasOwn(rank, mode) || rank[mode] < rank[baseMode]) fail('Child permissions cannot be broadened')
}

const guidance = (provider, child = false, { session, canDelegate: enabled, model, mode, messageType } = {}) => {
  const maxDepth = getUiSettings(config.writeDir).maxSubagentDepth
  const allowed = enabled ?? (session ? canSpawn(session) : !child && maxDepth > 0)
  const prompts = require('../prompts')
  const context = { model: model || require('../prompt/context').sessionModel(session), mode: mode ?? session?.mode, messageType }
  if (!allowed) return prompts.text('delegationChild', provider, context)
  if (!child && context.mode === 'leader') return prompts.text('delegationLeader', provider, context)
  const scope = child ? 'Stay within your assigned task. Return findings to your parent after any child work finishes, then stop.' : ''
  return [scope, prompts.text('delegationParent', provider, context)].filter(Boolean).join('\n\n')
}

const withDeliveryLock = (sessionId, fn) => withLock(sessionId, 'delivery', fn)

module.exports = { withDeliveryLock, childrenFor, childrenForAsync, hasPendingChildren, assertChildRun, canDelegate, canSpawn, open, authenticate, spawn, status, wait, stop, stopChildren, closeRun, cancelChild, recover, parentActive, parentAllowed, workflowAllowed, guidance, describe }
