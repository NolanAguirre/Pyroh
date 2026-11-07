const config = require('../config')
const paths = require('../store/paths')
const { readJson, readJsonAsync, writeJson } = require('../store/jsonFile')
const sessionStore = require('../store/sessionStore')
const sessionIndex = require('../store/sessionIndex')
const workspaceStore = require('../store/workspaceStore')
const questionStore = require('../store/questionStore')
const steerStore = require('../store/steerStore')
const imageStore = require('../store/imageStore')
const proc = require('./process')
const { listProviders } = require('../agents/driver')
const sessionLock = require('../store/sessionLock')
const { normalizeRunOptions, validatePromptDocument, validateSavedDescriptor } = require('../sdk')
const registry = require('../registry')
const { requestChatName } = require('../categorizer')
const prompts = require('../prompts')
const { sessionModel, sessionContext } = require('../prompt/context')
const { isDelegatedChild, detachDelegation } = require('../store/delegationBoundary')

const workflowMode = (session) => {
  if (!session?.mode) return null
  if (['agent', 'ask', 'plan'].includes(session.mode)) return null
  const entry = registry.findMode(registry.sessionWorkspace(session), session.mode)
  return entry?.pipeline ? entry : null
}

const isWorkflowResume = (session) => Boolean(session?.currentStep &&
  session.currentStep !== 'done' && (session.workflowPlugin || workflowMode(session)))

const replyMode = (session) => session?.mode && !session.workflowPlugin && !workflowMode(session)
  ? session.mode : 'agent'

// A mode that spawns a sibling session (memories, token waste, newSession
// plugins) runs as a plain turn when sent to a session already in that mode.
const repliesInPlace = (session, entry) =>
  Boolean(entry?.newSession) && session?.mode === entry.id

const lastPluginRun = (sessionId, mode) =>
  sessionStore.listRuns(sessionId, config.writeDir).findLast((item) => item.mode === mode && item.plugin)?.plugin

// Launch a detached daemon for a freshly created run. Returns the run record.
// autoName marks prompts typed by the user, in modes that may name an unnamed session.
// A session spawned from the source runs on the picked provider and model,
// falling back to the source's.
const resolveSpawnTarget = (source, target = {}) => {
  const provider = target.provider || source.provider
  if (!listProviders().includes(provider)) {
    throw Object.assign(new Error(`unknown provider: ${provider}`), { status: 400 })
  }
  const requested = target.model
  const model = requested == null || requested === ''
    ? (provider === source.provider ? (sessionModel(source) || null) : null)
    : requested
  return { provider, model }
}

// Provider options such as reasoning effort only carry over to the same provider and model.
const spawnSessionFields = (source, { provider, model }) => {
  const keepOptions = provider === source.provider && (model || null) === (sessionModel(source) || null)
  return {
    provider,
    model,
    ...(keepOptions ? { codex: source.codex, grok: source.grok, claude: source.claude } : {}),
  }
}

// The new chat records the mode picked for it, never new-chat itself. Only
// turn modes fit, since the continuation prompt is an ordinary turn.
const resolveNewChatTarget = (source, target = {}) => {
  const { provider, model } = resolveSpawnTarget(source, target)
  const mode = target.mode || 'agent'
  const entry = registry.requireMode(registry.sessionWorkspace(source), mode, { provider })
  if (entry.kind !== 'turn') {
    throw Object.assign(new Error(`new chat cannot start in ${mode} mode`), { status: 400 })
  }
  return { provider, model, mode }
}

const spawnRun = (sessionId, action, { mode, prompt, images, promptProvenance, autoName = false, handoff, plugin, onPrepared, allowQueued = false, delegationDelivery, queuedMessage, forkStart = false }) => {
  if (plugin) validateSavedDescriptor(plugin)
  images = imageStore.normalizeImages(sessionId, images, config.writeDir)
  if (images.length && prompt == null) prompt = ''
  const owned = !sessionLock.holds(sessionId, config.writeDir)
  const lock = sessionLock.acquire(sessionId, config.writeDir)
  const stopped = () => Object.assign(new Error('stopped'), { code: 'stopped' })
  try {
    sessionStore.recoverSession(sessionId, config.writeDir)
    const session = sessionStore.loadSession(sessionId, config.writeDir)
    if (session?.fork?.kind === 'native' && (session.fork.state !== 'ready' || !session.providerAgentId)) {
      throw Object.assign(new Error('Native fork creation must finish before starting a turn; retry the original fork request'), { status: 409 })
    }
    if (session?.fork?.initialMessagePending && !forkStart) {
      throw Object.assign(new Error('The initial fork message is still pending; retry the original fork request'), { status: 409 })
    }
    if (session?.status === 'queued' && !allowQueued) {
      throw Object.assign(new Error('session is queued'), { status: 409 })
    }
    const runAfter = require('./runAfter')
    if (allowQueued && runAfter.cancelled(sessionId)) throw stopped()
    require('./delegation').assertChildRun(session, mode, { userFollowup: !delegationDelivery })
    const firstUnnamedRun = Boolean(session) && session.name == null &&
      sessionStore.listRuns(sessionId, config.writeDir).length === 0
    require('fs').rmSync(paths.controlFile(sessionId, config.writeDir), { force: true })
    if (allowQueued && runAfter.cancelled(sessionId)) throw stopped()
    const run = sessionStore.createRun(sessionId, { mode, prompt, images, promptProvenance, handoff, plugin, delegationDelivery, queuedMessage }, config.writeDir)
    onPrepared?.(run)
    sessionStore.updateSession(sessionId, { status: 'running' }, config.writeDir)
    if (allowQueued && runAfter.cancelled(sessionId)) throw stopped()
    const pid = proc.spawnHarness([action, sessionId, '--run-id', run.id], lock.spawnOptions())
    if (autoName && firstUnnamedRun) requestChatName(sessionId, prompt)
    return { ...run, daemonPid: pid }
  } catch (err) {
    sessionStore.recoverSession(sessionId, config.writeDir)
    throw err
  } finally { if (owned) lock.release() }
}

const spawnWorkflow = (sessionId, { mode, resume = false, prompt, promptProvenance } = {}) => {
  const lock = sessionLock.acquire(sessionId, config.writeDir)
  try {
    sessionStore.recoverSession(sessionId, config.writeDir)
    const session = sessionStore.loadSession(sessionId, config.writeDir)
    if (!session) throw Object.assign(new Error(`session not found: ${sessionId}`), { status: 404 })
    if (session.status === 'queued') throw Object.assign(new Error('session is queued'), { status: 409 })
    mode ||= session.mode
    const entry = registry.requireMode(registry.sessionWorkspace(session), mode, { provider: session.provider })
    if (!entry.pipeline) throw Object.assign(new Error(`${mode} is not a workflow`), { status: 400 })
    if (resume) registry.assertCompatiblePlugin(session.workflowPlugin, entry)
    if (!resume && !prompt?.trim()) throw Object.assign(new Error('prompt is required'), { status: 400 })
    if (prompt) {
      sessionStore.writeSourcePlan(sessionId, prompt, config.writeDir)
      sessionStore.updateSession(sessionId, { sourcePlanProvenance: require('../prompt/provenance').supplied(prompt, promptProvenance) }, config.writeDir)
    }
    require('fs').rmSync(paths.controlFile(sessionId, config.writeDir), { force: true })
    const args = ['workflow', sessionId, '--mode', mode]
    if (resume) args.push('--resume')
    sessionStore.updateSession(sessionId, {
      mode, status: 'running', workflowPlugin: registry.turnDescriptor(entry),
      ...(!resume ? { currentPhase: null, currentStep: null, totalPhases: null } : {}),
    }, config.writeDir)
    const pid = proc.spawnHarness(args, lock.spawnOptions())
    return { sessionId, mode, resume: Boolean(resume), daemonPid: pid }
  } catch (err) {
    sessionStore.recoverSession(sessionId, config.writeDir)
    throw err
  } finally { lock.release() }
}

const daemonPidOf = (sessionId) => {
  const record = readJson(paths.daemonPid(sessionId, config.writeDir), null)
  return sessionLock.ownerAlive(record) ? record.pid : null
}

const daemonPidOfAsync = async (sessionId) => {
  const record = await readJsonAsync(paths.daemonPid(sessionId, config.writeDir), null)
  return sessionLock.ownerAlive(record) ? record.pid : null
}

const BUSY = ['running', 'awaiting_input']

// A daemon killed without finalizing leaves the session busy. Only that case
// needs the lock: it is free unless a daemon is starting or still alive.
const recoverDeadDaemon = (session, daemonPid) => {
  if (!session || daemonPid || !BUSY.includes(session.status)) return session
  let lock
  try {
    lock = sessionLock.acquire(session.id, config.writeDir)
    return sessionStore.recoverSession(session.id, config.writeDir)
  } catch (err) {
    if (err.status !== 409) throw err
    return session
  } finally { lock?.release() }
}

const createWorkspace = ({ name, cwd }) =>
  workspaceStore.createWorkspace({ name, cwd }, config.writeDir)

const listWorkspaces = () => workspaceStore.listWorkspacesAsync(config.writeDir)

const getWorkspace = (workspaceId) =>
  workspaceStore.loadWorkspaceAsync(workspaceId, config.writeDir)

const updateWorkspace = (workspaceId, patch) =>
  workspaceStore.updateWorkspace(workspaceId, patch, config.writeDir)

const createSession = ({ workspaceId, provider, model, codex, grok, claude }) =>
  sessionStore.createSession({ workspaceId, provider, model, codex, grok, claude }, config.writeDir)


// Compatibility helpers use the same plugin preparation as ordinary launches.
const createTokenWasteSession = (sessionId, options) => preparePluginSession(sessionId, 'token-waste', options)
const createMemorySession = (sessionId, options) => preparePluginSession(sessionId, 'memory-extract', options)
const preparePluginSession = (sessionId, mode, options = {}) => {
  const source = sessionStore.loadSession(sessionId, config.writeDir)
  if (!source) throw Object.assign(new Error(`session not found: ${sessionId}`), { status: 404 })
  const workspace = registry.sessionWorkspace(source)
  if (!workspace) throw Object.assign(new Error(`${mode}: plugin modes need a workspace`), { status: 400 })
  const harness = registry.makeHarnessApi(workspace, source)
  return preparePluginTurn(source, registry.requireMode(workspace, mode, { harness, provider: source.provider }), harness, options)
}

const continueInNewChat = (sourceSessionId, prompt, target, images) => {
  const source = sessionStore.loadSession(sourceSessionId, config.writeDir)
  if (!source) throw Object.assign(new Error(`session not found: ${sourceSessionId}`), { status: 404 })
  images = imageStore.normalizeImages(sourceSessionId, images, config.writeDir)
  const workspaceId = source.workspaceId || workspaceStore.findWorkspaceByCwd(source.cwd, config.writeDir)?.id
  const next = resolveNewChatTarget(source, target)
  const created = createSession({ workspaceId, ...spawnSessionFields(source, next) })
  const { mode } = next
  const { autoName } = registry.requireMode(registry.sessionWorkspace(source), mode, { provider: next.provider })
  const session = sessionStore.updateSession(created.id, { sourceSessionId, mode }, config.writeDir)
  const run = spawnRun(session.id, mode === 'plan' ? 'plan' : 'run', { mode, prompt, images, autoName })
  return { session, run }
}

const forkSession = async (sourceSessionId, prompt = '', forkRetryKey, promptProvenance, images) => {
  images = imageStore.normalizeImages(sourceSessionId, images, config.writeDir)
  if (typeof prompt !== 'string' || (!prompt.trim() && !images.length)) {
    throw Object.assign(new Error('prompt or images are required'), { status: 400 })
  }
  const lock = sessionLock.acquire(sourceSessionId, config.writeDir, { exclusive: true })
  try {
    sessionStore.recoverSession(sourceSessionId, config.writeDir)
    const source = sessionStore.loadSession(sourceSessionId, config.writeDir)
    if (!source) throw Object.assign(new Error(`session not found: ${sourceSessionId}`), { status: 404 })
    if (['running', 'awaiting_input', 'queued'].includes(source.status)) {
      throw Object.assign(new Error('Finish or stop the current turn before forking'), { status: 409 })
    }
    const runs = sessionStore.listRuns(sourceSessionId, config.writeDir)
    if (!runs.length) throw Object.assign(new Error('Start a conversation before forking'), { status: 400 })
    const latest = runs.findLast(item => registry.turnMode(item.mode, item.plugin)?.kind === 'turn' || item.plugin)
    const previous = registry.turnMode(latest?.mode || replyMode(source), latest?.plugin)
    const mode = previous?.base || 'agent'
    const entry = registry.requireMode(registry.sessionWorkspace(source), mode, { provider: source.provider })
    const workspaceId = source.workspaceId || workspaceStore.findWorkspaceByCwd(source.cwd, config.writeDir)?.id
    const { session, requestFile } = await require('./nativeFork').ensureNativeFork(source, {
      workspaceId, sessionFields: spawnSessionFields(source, source), mode, prompt, images, retryKey: forkRetryKey,
    })
    // A persisted first run means delivery may already have happened. A lost
    // HTTP response or failed daemon launch must not resend the user's message.
    const existing = sessionStore.listRuns(session.id, config.writeDir)[0]
    if (existing) {
      if (session.fork.initialMessagePending) sessionStore.updateSession(session.id, {
        fork: { ...session.fork, initialMessagePending: false, firstRunId: existing.id },
      }, config.writeDir)
      return existing
    }
    return spawnRun(session.id, session.mode === 'plan' ? 'plan' : 'run', {
      mode: session.mode, prompt, images, promptProvenance, autoName: entry.autoName, forkStart: true,
      onPrepared: (run) => {
        writeJson(requestFile, { ...readJson(requestFile), firstRunId: run.id })
        sessionStore.updateSession(session.id, {
          fork: { ...session.fork, initialMessagePending: false, firstRunId: run.id },
        }, config.writeDir)
      },
    })
  } finally { lock.release() }
}

// Both bundled and external modes enter through this contract.
const pluginContext = (source, session, harness, options, runId = null) => ({
  workspace: harness.workspace, session, sourceSession: source, runId,
  prompt: options.prompt || '', promptProvenance: options.promptProvenance, options,
})

const preparePluginTurn = async (source, plugin, harness, options = {}) => {
  options = normalizeRunOptions(options)
  options.images = imageStore.normalizeImages(source.id, options.images, config.writeDir)
  let session = source
  if (plugin.newSession) {
    const created = harness.sessions.create({ provider: options.provider, model: options.model })
    session = sessionStore.updateSession(created.id, {
      mode: plugin.id, sourceSessionId: source.id,
      ...(plugin.sessionName ? { name: plugin.sessionName } : {}),
    }, config.writeDir)
  }
  const ctx = pluginContext(source, session, harness, options)
  const built = await plugin.buildPrompt(ctx, harness)
  if (typeof built !== 'string') validatePromptDocument(built)
  const text = typeof built === 'string' ? built : built?.text
  if (typeof text !== 'string' || !text.trim()) {
    throw Object.assign(new Error(`${plugin.id}: buildPrompt returned no prompt`), { status: 400 })
  }
  const instructions = typeof plugin.instructions === 'function'
    ? await plugin.instructions(ctx, harness) : plugin.instructions
  return {
    session, prompt: text, images: options.images,
    promptProvenance: typeof built === 'string' ? options.promptProvenance : built,
    plugin: { ...registry.turnDescriptor(plugin, instructions), sourceSessionId: source.id, options },
  }
}

const runPlugin = async (source, plugin, harness, options) => {
  if (plugin.launch) return plugin.launch(pluginContext(source, source, harness, options), harness)
  const prepared = await preparePluginTurn(source, plugin, harness, options)
  return spawnRun(prepared.session.id, 'run', {
    mode: plugin.id, prompt: prepared.prompt, promptProvenance: prepared.promptProvenance,
    images: prepared.images,
    plugin: prepared.plugin, autoName: plugin.autoName,
  })
}

const decompose = (sessionId, options) => spawnWorkflow(sessionId, { ...options, mode: 'decompose' })

const resumeInput = (session, mode, prompt, promptProvenance) => {
  if (prompt) return { prompt, promptProvenance }
  const text = prompts.text('resume', session?.provider, sessionContext(session, mode))
  return { prompt: text, promptProvenance: { sections: [{ kind: 'system', label: 'Resume instructions', text }] } }
}

// Every mode is looked up in the registry, which also enforces deny rules.
const run = async (sessionId, input = {}) => {
  const options = normalizeRunOptions(input)
  const { prompt, runAfterSessionId, promptProvenance } = options
  const source = sessionStore.loadSession(sessionId, config.writeDir)
  if (!source) throw Object.assign(new Error(`session not found: ${sessionId}`), { status: 404 })
  const images = imageStore.normalizeImages(sessionId, options.images, config.writeDir)
  options.images = images
  if (source.status === 'queued') throw Object.assign(new Error('session is queued'), { status: 409 })
  const mode = options.mode || replyMode(source)
  const workspace = registry.sessionWorkspace(source)
  const harness = workspace ? registry.makeHarnessApi(workspace, source) : undefined
  const entry = registry.requireMode(workspace, mode, { harness, provider: source.provider })
  if (images.length && (entry.pipeline || (entry.launch && mode !== 'fork'))) {
    throw Object.assign(new Error(`Image attachments are not supported in ${mode} mode`), { status: 400 })
  }
  if (entry.launch) {
    if (!harness) throw Object.assign(new Error(`${mode}: plugin modes need a workspace`), { status: 400 })
    if (runAfterSessionId) throw Object.assign(new Error(`${mode} cannot be scheduled with run after`), { status: 400 })
    return runPlugin(source, entry, harness, { ...options, mode })
  }
  require('./delegation').assertChildRun(source, mode, { userFollowup: true })
  if (runAfterSessionId != null && runAfterSessionId !== '') {
    const outcome = require('./runAfter').enqueue(source, { prompt, images, mode, runAfterSessionId, promptProvenance })
    if (outcome) return { sessionId, mode, ...outcome }
  }
  if (repliesInPlace(source, entry)) {
    const plugin = entry.kind === 'plugin' ? lastPluginRun(sessionId, mode) || registry.turnDescriptor(entry) : undefined
    return spawnRun(sessionId, 'run', { mode, ...resumeInput(source, mode, prompt, promptProvenance), images, plugin })
  }
  if (entry.pipeline) return spawnWorkflow(sessionId, { mode, prompt, promptProvenance })
  if (entry.kind === 'plugin') {
    if (!harness) throw Object.assign(new Error(`${mode}: plugin modes need a workspace`), { status: 400 })
    return runPlugin(source, entry, harness, { ...options, mode })
  }
  if (!source.mode) sessionStore.updateSession(sessionId, { mode }, config.writeDir)
  return spawnRun(sessionId, mode === 'plan' ? 'plan' : 'run', { mode, prompt, images, promptProvenance, autoName: entry.autoName })
}

const plan = (sessionId, { prompt, images }) => run(sessionId, { mode: 'plan', prompt, images })

// A run that lost the network before its agent started never delivered its
// prompt, so resuming must resend it rather than "continue".
const undeliveredRun = (sessionId, session) => {
  if (session?.status !== 'disconnected') return null
  const last = sessionStore.listRuns(sessionId, config.writeDir).at(-1)
  return last && last.status === 'disconnected' && !last.providerAgentId && (last.prompt || last.images?.length) ? last : null
}

const resume = (sessionId, { prompt, mode: requested, promptProvenance, images } = {}) => {
  const session = sessionStore.loadSession(sessionId, config.writeDir)
  if (session?.status === 'queued') {
    throw Object.assign(new Error('queued session cannot be resumed'), { status: 409 })
  }
  images = imageStore.normalizeImages(sessionId, images, config.writeDir)
  if (isWorkflowResume(session)) {
    if (images.length) throw Object.assign(new Error('Image attachments are not supported in workflow mode'), { status: 400 })
    return spawnWorkflow(sessionId, { mode: session.mode, resume: true })
  }
  const retry = !prompt && !images.length && undeliveredRun(sessionId, session)
  if (retry) return spawnRun(sessionId, 'resume', { mode: retry.mode, prompt: retry.prompt, images: retry.images, promptProvenance: retry.promptProvenance, handoff: retry.handoff, plugin: retry.plugin })
  const mode = requested || replyMode(session)
  return spawnRun(sessionId, 'resume', { mode, ...resumeInput(session, mode, prompt, promptProvenance), images, plugin: lastPluginRun(sessionId, mode) })
}

const terminate = (sessionId, intent, { delegated = false } = {}) => require('./delegation').withDeliveryLock(sessionId, () => {
  if (delegated && sessionStore.loadSession(sessionId, config.writeDir)?.delegationDetached) return { signalled: false, pid: null }
  require('../store/queuedMessageStore').clear(sessionId, config.writeDir)
  require('./delegation').cancelChild(sessionId)
  for (const run of sessionStore.listRuns(sessionId, config.writeDir)) require('./delegation').stopChildren(sessionId, run.id)
  writeJson(paths.controlFile(sessionId, config.writeDir), { intent, at: Date.now() })
  const pid = daemonPidOf(sessionId)
  const signalled = pid ? proc.signal(pid, 'SIGTERM') : false
  const status = intent === 'stop' ? 'stopped' : 'paused'
  const session = sessionStore.loadSession(sessionId, config.writeDir)
  if (session) sessionStore.updateSession(sessionId, { status, ...(session.parentRunId && !session.delegationDetached ? { stopRequestedAt: session.stopRequestedAt || Date.now() } : {}) }, config.writeDir)
  return { signalled, pid }
})

const pause = (sessionId) => {
  const session = sessionStore.loadSession(sessionId, config.writeDir)
  if (session?.status === 'queued') {
    throw Object.assign(new Error('queued session cannot be paused'), { status: 409 })
  }
  return terminate(sessionId, 'pause')
}

const stop = (sessionId, { delegated = false } = {}) => {
  const session = sessionStore.loadSession(sessionId, config.writeDir)
  if (session?.status !== 'queued') return terminate(sessionId, 'stop', { delegated })
  const runAfter = require('./runAfter')
  if (sessionLock.holds(sessionId, config.writeDir)) {
    runAfter.requestCancel(sessionId)
    return { signalled: false, pid: null }
  }
  let lock
  try {
    lock = sessionLock.acquire(sessionId, config.writeDir)
  } catch (err) {
    if (err.status !== 409) throw err
    runAfter.requestCancel(sessionId)
    writeJson(paths.controlFile(sessionId, config.writeDir), { intent: 'stop', at: Date.now() })
    const pid = daemonPidOf(sessionId)
    return { signalled: pid ? proc.signal(pid, 'SIGTERM') : false, pid }
  }
  try {
    const current = sessionStore.loadSession(sessionId, config.writeDir)
    if (!current || current.status !== 'queued') return terminate(sessionId, 'stop')
    runAfter.cancelQueued(current)
    return { signalled: false, pid: null }
  } finally { lock.release() }
}

const answer = (sessionId, qid, value) =>
  questionStore.answer(sessionId, qid, value, config.writeDir)

const steer = (sessionId, text, options = {}) => {
  const session = sessionStore.loadSession(sessionId, config.writeDir)
  if (!session) throw Object.assign(new Error(`session not found: ${sessionId}`), { status: 404 })
  if (session.status === 'queued') throw Object.assign(new Error('session is queued'), { status: 409 })
  if (registry.findMode(registry.sessionWorkspace(session), session.mode)?.steerable === false) {
    throw Object.assign(new Error(`${session.mode} sessions cannot be steered`), { status: 409 })
  }
  if (!daemonPidOf(sessionId) || !['running', 'awaiting_input'].includes(session.status)) {
    throw Object.assign(new Error('session has no running agent to steer'), { status: 409 })
  }
  if (isDelegatedChild(session)) detachDelegation(session, sessionStore.listRuns(sessionId, config.writeDir), config.writeDir)
  const images = imageStore.normalizeImages(sessionId, options.images, config.writeDir)
  return steerStore.write(sessionId, text ?? '', config.writeDir, { ...options, images })
}

const status = async (sessionId) => {
  const [loaded, pid] = await Promise.all([
    sessionStore.loadSessionAsync(sessionId, config.writeDir),
    daemonPidOfAsync(sessionId),
  ])
  if (!loaded) return null
  const session = recoverDeadDaemon(loaded, pid)
  const [runs, questions] = await Promise.all([
    sessionStore.listRunsAsync(sessionId, config.writeDir),
    questionStore.listQuestionsAsync(sessionId, config.writeDir),
  ])
  const inherited = session.fork ? require('./fork').readForkHistory(sessionId, config.writeDir) : null
  return {
    session,
    runs: [...(inherited?.runs || []), ...runs],
    questions: [...(inherited?.questions || []), ...questions],
    daemonPid: pid,
    daemonAlive: proc.isAlive(pid),
  }
}

// Lists read the persisted index immediately. The maintenance process repairs
// interrupted runs and reconciles file changes independently of page loads.
const list = async (workspaceId, { includeArchived = false, orderBy = 'createdAt', order = 'desc', limit, active, fields } = {}) => {
  await sessionIndex.whenReady()
  const workspaces = new Map((await workspaceStore.listWorkspacesAsync(config.writeDir))
    .map(workspace => [workspace.id, workspace]))
  return sessionIndex.query({ workspaceId, includeArchived, active, orderBy, order, limit, fields })
    .map(session => {
      const workspace = session.workspaceId ? workspaces.get(session.workspaceId) : null
      return sessionStore.withCwd(session, workspace?.cwd || session.cwd || config.workBase, config.writeDir)
    })
}

module.exports = {
  spawnRun,
  createWorkspace,
  listWorkspaces,
  getWorkspace,
  updateWorkspace,
  createSession,
  preparePluginTurn,
  spawnWorkflow,
  isWorkflowResume,
  createTokenWasteSession,
  createMemorySession,
  resolveNewChatTarget,
  continueInNewChat,
  forkSession,
  replyMode,
  repliesInPlace,
  plan,
  run,
  decompose,
  resume,
  pause,
  stop,
  answer,
  steer,
  queue: (sessionId, options) => require('./queuedMessages').enqueue(sessionId, options),
  cancelQueuedMessage: (sessionId, messageId) => require('./queuedMessages').cancel(sessionId, messageId),
  sendQueuedMessage: (sessionId, messageId) => require('./queuedMessages').send(sessionId, messageId),
  status,
  list,
  recoverDeadDaemon,
  daemonPidOfAsync,
}
