const config = require('../config')
const workspaceStore = require('../store/workspaceStore')
const { tersePrompt, askPrompt } = require('../agents/modes')
const { transcriptDirectories } = require('../modes/tokenWaste')
const { transcriptFiles } = require('../modes/memoryExtract')
const prompts = require('../prompts')
const { sessionContext } = require('../prompt/context')

// Lazy so Harness can require this module without a cycle.
const harnessModule = () => require('../harness/Harness')

const log = (msg) => process.stdout.write(`[${new Date().toISOString()}] [plugins] ${msg}\n`)

const sessionWorkspace = (session) => {
  if (!session) return null
  return session.workspaceId
    ? workspaceStore.loadWorkspace(session.workspaceId, config.writeDir)
    : workspaceStore.findWorkspaceByCwd(session.cwd, config.writeDir)
}

// The API plugins get, limited to one workspace. `source` is the session the
// plugin runs from; new sessions copy its provider and model unless told otherwise.
const makeHarnessApi = (workspace, source) => {
  const inWorkspace = (session) => {
    if (!session) throw Object.assign(new Error('session not found'), { status: 404 })
    if (sessionWorkspace(session)?.id !== workspace.id) {
      throw Object.assign(new Error(`session ${session.id} is not in workspace ${workspace.id}`), { status: 403 })
    }
    return session
  }
  const loadSession = (sessionId) =>
    inWorkspace(require('../store/sessionStore').loadSession(sessionId, config.writeDir))

  const createSession = ({ provider, model } = {}) => {
      const Harness = harnessModule()
      const target = source
        ? Harness.resolveNewChatTarget(source, { provider, model })
        : { provider: provider || 'cursor', model: model || null }
      const keepOptions = source && target.provider === source.provider && (target.model || null) === (source.model || null)
      return Harness.createSession({
        workspaceId: workspace.id,
        ...target,
        ...(keepOptions ? { codex: source.codex, grok: source.grok, claude: source.claude } : {}),
      })
  }
  const inspectRun = (sessionId, runId) => {
    loadSession(sessionId)
    const run = require('../store/sessionStore').loadRun(sessionId, runId, config.writeDir)
    if (!run) throw Object.assign(new Error(`run not found: ${runId}`), { status: 404 })
    return run
  }
  const awaitRun = async (sessionId, runId, { signal, timeoutMs } = {}) => {
    const started = Date.now()
    while (true) {
      if (signal?.aborted) throw signal.reason || new Error('run wait cancelled')
      await harnessModule().status(loadSession(sessionId).id)
      const run = inspectRun(sessionId, runId)
      if (run.endedAt) return run
      if (timeoutMs != null && Date.now() - started >= timeoutMs) {
        throw Object.assign(new Error('run wait timed out'), { code: 'timeout' })
      }
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }

  return {
    workspace,
    capabilities: { memory: Boolean(config.memoryMcpUrl) },
    prompts: {
      terse: tersePrompt(), ask: askPrompt(),
      context: (session, mode) => sessionContext(session, mode),
      render: (id, vars, session, mode, metadata) =>
        prompts.renderWithProvenance(id, vars, session.provider, sessionContext(session, mode), metadata),
      focus: (text, session, mode, metadata) =>
        prompts.focusWithProvenance(text, session.provider, sessionContext(session, mode), metadata),
    },
    sessions: {
      create: createSession,
      inspect: loadSession,
      resolveTarget: (sessionId, target) => harnessModule().resolveNewChatTarget(loadSession(sessionId), target),
      continue: (sessionId, prompt, target) => {
        loadSession(sessionId)
        return harnessModule().continueInNewChat(sessionId, prompt, target)
      },
      fork: (sessionId, { prompt, forkRetryKey, promptProvenance } = {}) => {
        loadSession(sessionId)
        return harnessModule().forkSession(sessionId, prompt, forkRetryKey, promptProvenance)
      },
    },
    runs: {
      inspect: inspectRun,
      await: awaitRun,
      cancel: (sessionId, runId) => {
        const run = inspectRun(sessionId, runId)
        if (run.endedAt) return { signalled: false, pid: null }
        const latest = require('../store/sessionStore').listRuns(sessionId, config.writeDir).at(-1)
        if (latest?.id !== runId) throw Object.assign(new Error('run is not the current run'), { status: 409 })
        return harnessModule().stop(sessionId)
      },
    },
    transcripts: {
      describe: (sessionId, format) => {
        loadSession(sessionId)
        if (!['directories', 'files'].includes(format)) throw new Error('unknown transcript reference format')
        return prompts.directoryLines(format === 'files'
          ? transcriptFiles(sessionId, config.writeDir) : transcriptDirectories(sessionId, config.writeDir))
      },
    },
    createSession,
    run: (sessionId, options = {}) => {
      loadSession(sessionId)
      return harnessModule().run(sessionId, options)
    },
    status: (sessionId) => {
      loadSession(sessionId)
      return harnessModule().status(sessionId)
    },
    transcriptDirs: (sessionId) => {
      loadSession(sessionId)
      return transcriptDirectories(sessionId, config.writeDir)
    },
    log: (msg) => log(`${workspace.name || workspace.id}: ${msg}`),
  }
}

module.exports = { log, sessionWorkspace, makeHarnessApi }
