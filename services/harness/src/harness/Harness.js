const config = require('../config')
const paths = require('../store/paths')
const { readJson, readJsonAsync, writeJson } = require('../store/jsonFile')
const sessionStore = require('../store/sessionStore')
const sessionIndex = require('../store/sessionIndex')
const workspaceStore = require('../store/workspaceStore')
const questionStore = require('../store/questionStore')
const steerStore = require('../store/steerStore')
const proc = require('./process')
const { listProviders } = require('../agents/driver')
const sessionLock = require('../store/sessionLock')
const tokenWaste = require('../modes/tokenWaste')
const memoryExtract = require('../modes/memoryExtract')
const newChat = require('../modes/newChat')
const registry = require('../registry')
const { requestChatName } = require('../categorizer')

const DEFAULT_RESUME_PROMPT = 'Continue where you left off'

const isDecomposeResume = (session) =>
  session &&
  session.mode === 'decompose' &&
  session.currentStep &&
  session.currentStep !== 'done'

// session.mode is the mode the session was spawned in. Replies default to it,
// except decompose, whose pipeline is not a reply.
const replyMode = (session) =>
  session?.mode && session.mode !== 'decompose' ? session.mode : 'agent'

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
    ? (provider === source.provider ? (source.model || null) : null)
    : requested
  return { provider, model }
}

// Provider options such as reasoning effort only carry over to the same provider and model.
const spawnSessionFields = (source, { provider, model }) => {
  const keepOptions = provider === source.provider && (model || null) === (source.model || null)
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

const spawnRun = (sessionId, action, { mode, prompt, autoName = false, handoff, plugin }) => {
  const lock = sessionLock.acquire(sessionId, config.writeDir)
  try {
    sessionStore.recoverSession(sessionId, config.writeDir)
    const session = sessionStore.loadSession(sessionId, config.writeDir)
    const firstUnnamedRun = Boolean(session) && session.name == null &&
      sessionStore.listRuns(sessionId, config.writeDir).length === 0
    const run = sessionStore.createRun(sessionId, { mode, prompt, handoff, plugin })
    sessionStore.updateSession(sessionId, { status: 'running' }, config.writeDir)
    const pid = proc.spawnHarness([action, sessionId, '--run-id', run.id], lock.spawnOptions())
    if (autoName && firstUnnamedRun) requestChatName(sessionId, prompt)
    return { ...run, daemonPid: pid }
  } catch (err) {
    sessionStore.recoverSession(sessionId, config.writeDir)
    throw err
  } finally { lock.release() }
}

const spawnDecompose = (sessionId, { resume = false, prompt } = {}) => {
  const lock = sessionLock.acquire(sessionId, config.writeDir)
  try {
    sessionStore.recoverSession(sessionId, config.writeDir)
    if (prompt) sessionStore.writeSourcePlan(sessionId, prompt, config.writeDir)
    const args = ['decompose', sessionId]
    if (resume) args.push('--resume')
    sessionStore.updateSession(sessionId, { status: 'running' }, config.writeDir)
    const pid = proc.spawnHarness(args, lock.spawnOptions())
    return { sessionId, mode: 'decompose', resume: Boolean(resume), daemonPid: pid }
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


// A new session next to the source that reads the source's transcripts.
const createSiblingSession = (modeId, buildPrompt, sourceSessionId, { focus, provider, model } = {}) => {
  const entry = registry.builtinMode(modeId)
  const source = sessionStore.loadSession(sourceSessionId, config.writeDir)
  if (!source) throw Object.assign(new Error(`session not found: ${sourceSessionId}`), { status: 404 })
  const target = resolveSpawnTarget(source, { provider, model })
  registry.requireMode(registry.sessionWorkspace(source), entry.id, { provider: target.provider })
  const prompt = buildPrompt(sourceSessionId, focus, config.writeDir)
  const workspaceId = source.workspaceId || workspaceStore.findWorkspaceByCwd(source.cwd, config.writeDir)?.id
  const created = createSession({ workspaceId, ...spawnSessionFields(source, target) })
  const session = sessionStore.updateSession(created.id, {
    mode: entry.id, sourceSessionId, name: entry.sessionName,
  }, config.writeDir)
  return { session, prompt }
}

const createTokenWasteSession = (sourceSessionId, { prompt: focus, provider, model } = {}) =>
  createSiblingSession(tokenWaste.MODE, tokenWaste.buildPrompt, sourceSessionId, { focus, provider, model })

const createMemorySession = (sourceSessionId, { prompt: focus, provider, model } = {}) => {
  if (!config.memoryMcpUrl) {
    throw Object.assign(new Error('memory extraction needs HARNESS_MEMORY_MCP_URL (the mcp-memory service)'), { status: 400 })
  }
  return createSiblingSession(memoryExtract.MODE, memoryExtract.buildPrompt, sourceSessionId, { focus, provider, model })
}

const continueInNewChat = (sourceSessionId, prompt, target) => {
  const source = sessionStore.loadSession(sourceSessionId, config.writeDir)
  if (!source) throw Object.assign(new Error(`session not found: ${sourceSessionId}`), { status: 404 })
  const workspaceId = source.workspaceId || workspaceStore.findWorkspaceByCwd(source.cwd, config.writeDir)?.id
  const next = resolveNewChatTarget(source, target)
  const created = createSession({ workspaceId, ...spawnSessionFields(source, next) })
  const mode = target?.mode || 'agent'
  const session = sessionStore.updateSession(created.id, { sourceSessionId, mode }, config.writeDir)
  const run = spawnRun(session.id, mode === 'plan' ? 'plan' : 'run', { mode, prompt })
  return { session, run }
}

// Plugin modes come from the session's workspace or global plugins. A fresh
// sibling session gets the run when the mode asks for one, as token-waste does.
const runPlugin = async (source, plugin, harness, { prompt, provider, model }) => {
  let session = source
  if (plugin.newSession) {
    const created = harness.createSession({ provider, model })
    session = sessionStore.updateSession(created.id, { mode: plugin.id, sourceSessionId: source.id }, config.writeDir)
  }
  const ctx = { workspace: harness.workspace, session, runId: null, prompt: prompt || '' }
  const text = await plugin.buildPrompt(ctx, harness)
  if (typeof text !== 'string' || !text.trim()) {
    throw Object.assign(new Error(`${plugin.id}: buildPrompt returned no prompt`), { status: 400 })
  }
  const instructions = typeof plugin.instructions === 'function'
    ? await plugin.instructions(ctx, harness)
    : plugin.instructions
  return spawnRun(session.id, 'run', {
    mode: plugin.id,
    prompt: text,
    plugin: { id: plugin.id, base: plugin.base, terse: plugin.terse, instructions: instructions ? String(instructions) : null },
  })
}

const decompose = (sessionId, { prompt }) => {
  if (!prompt) throw new Error('prompt is required')
  const session = sessionStore.loadSession(sessionId, config.writeDir)
  if (!session) throw new Error(`session not found: ${sessionId}`)
  return spawnDecompose(sessionId, { resume: false, prompt })
}

// Every mode is looked up in the registry, which also enforces deny rules.
const run = async (sessionId, { prompt, mode: requested, provider, model, targetMode } = {}) => {
  const source = sessionStore.loadSession(sessionId, config.writeDir)
  if (!source) throw Object.assign(new Error(`session not found: ${sessionId}`), { status: 404 })
  const mode = requested || replyMode(source)
  const workspace = registry.sessionWorkspace(source)
  const harness = workspace ? registry.makeHarnessApi(workspace, source) : undefined
  const entry = registry.requireMode(workspace, mode, { harness, provider: source.provider })
  if (repliesInPlace(source, entry)) {
    const plugin = entry.kind === 'plugin' ? lastPluginRun(sessionId, entry.id) : undefined
    return spawnRun(sessionId, 'run', { mode, prompt: prompt || DEFAULT_RESUME_PROMPT, plugin })
  }
  if (entry.kind === 'turn' && !source.mode) sessionStore.updateSession(sessionId, { mode: entry.id }, config.writeDir)
  switch (entry.kind) {
    case 'plugin':
      if (!harness) throw Object.assign(new Error(`${entry.id}: plugin modes need a workspace`), { status: 400 })
      return runPlugin(source, entry, harness, { prompt, provider, model })
    case 'token-waste': {
      const analysis = createTokenWasteSession(sessionId, { prompt, provider, model })
      return spawnRun(analysis.session.id, 'run', { mode, prompt: analysis.prompt })
    }
    case 'memory': {
      const extraction = createMemorySession(sessionId, { prompt, provider, model })
      return spawnRun(extraction.session.id, 'run', { mode, prompt: extraction.prompt })
    }
    case 'new-chat': {
      const handoff = resolveNewChatTarget(source, { provider, model, mode: targetMode })
      return spawnRun(sessionId, 'run', { mode, prompt: newChat.buildPrompt(prompt), handoff })
    }
    case 'decompose':
      return decompose(sessionId, { prompt })
    default:
      return spawnRun(sessionId, entry.id === 'plan' ? 'plan' : 'run', { mode, prompt, autoName: entry.autoName })
  }
}

const plan = (sessionId, { prompt }) => run(sessionId, { mode: 'plan', prompt })

// A run that lost the network before its agent started never delivered its
// prompt, so resuming must resend it rather than "continue".
const undeliveredRun = (sessionId, session) => {
  if (session?.status !== 'disconnected') return null
  const last = sessionStore.listRuns(sessionId, config.writeDir).at(-1)
  return last && last.status === 'disconnected' && !last.providerAgentId && last.prompt ? last : null
}

const resume = (sessionId, { prompt, mode: requested } = {}) => {
  const session = sessionStore.loadSession(sessionId, config.writeDir)
  if (isDecomposeResume(session)) return spawnDecompose(sessionId, { resume: true })
  const retry = !prompt && undeliveredRun(sessionId, session)
  if (retry) return spawnRun(sessionId, 'resume', { mode: retry.mode, prompt: retry.prompt, handoff: retry.handoff, plugin: retry.plugin })
  const mode = requested || replyMode(session)
  return spawnRun(sessionId, 'resume', { mode, prompt: prompt || DEFAULT_RESUME_PROMPT, plugin: lastPluginRun(sessionId, mode) })
}

const terminate = (sessionId, intent) => {
  writeJson(paths.controlFile(sessionId, config.writeDir), { intent, at: Date.now() })
  const pid = daemonPidOf(sessionId)
  const signalled = pid ? proc.signal(pid, 'SIGTERM') : false
  const status = intent === 'stop' ? 'stopped' : 'paused'
  const session = sessionStore.loadSession(sessionId, config.writeDir)
  if (session) sessionStore.updateSession(sessionId, { status }, config.writeDir)
  return { signalled, pid }
}

const pause = (sessionId) => terminate(sessionId, 'pause')

const stop = (sessionId) => terminate(sessionId, 'stop')

const answer = (sessionId, qid, value) =>
  questionStore.answer(sessionId, qid, value, config.writeDir)

const steer = (sessionId, text) => {
  const session = sessionStore.loadSession(sessionId, config.writeDir)
  if (!session) throw Object.assign(new Error(`session not found: ${sessionId}`), { status: 404 })
  if (registry.builtinMode(session.mode)?.steerable === false) {
    throw Object.assign(new Error(`${session.mode} sessions cannot be steered`), { status: 409 })
  }
  if (!daemonPidOf(sessionId) || !['running', 'awaiting_input'].includes(session.status)) {
    throw Object.assign(new Error('session has no running agent to steer'), { status: 409 })
  }
  return steerStore.write(sessionId, text, config.writeDir)
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
  return { session, runs, questions, daemonPid: pid, daemonAlive: proc.isAlive(pid) }
}

// Busy rows are recovered first so their write-through updates are visible to the filtered query.
const list = async (workspaceId, { includeArchived = false, orderBy = 'createdAt', order = 'desc', limit, active, fields } = {}) => {
  await sessionIndex.whenReady()
  const busy = sessionIndex.query({ workspaceId, includeArchived, active: true })
  await Promise.all(busy.map(async session => recoverDeadDaemon(session, await daemonPidOfAsync(session.id))))
  const workspaces = new Map((await workspaceStore.listWorkspacesAsync(config.writeDir))
    .map(workspace => [workspace.id, workspace]))
  return sessionIndex.query({ workspaceId, includeArchived, active, orderBy, order, limit, fields })
    .map(session => {
      const workspace = session.workspaceId ? workspaces.get(session.workspaceId) : null
      return sessionStore.withCwd(session, workspace?.cwd || session.cwd || config.workBase, config.writeDir)
    })
}

module.exports = {
  createWorkspace,
  listWorkspaces,
  getWorkspace,
  updateWorkspace,
  createSession,
  createTokenWasteSession,
  createMemorySession,
  resolveNewChatTarget,
  continueInNewChat,
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
  status,
  list,
  recoverDeadDaemon,
  daemonPidOfAsync,
}
