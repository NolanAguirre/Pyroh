import type { HarnessApi, Session, SessionOptions, Workspace } from '../sdk'
const config = require('../config')
const workspaceStore = require('../store/workspaceStore')
const { tersePrompt, askPrompt } = require('../agents/modes')
const { transcriptDirectories } = require('../modes/tokenWaste')
const { transcriptFiles } = require('../modes/memoryExtract')
const prompts = require('../prompts')
const { sessionContext } = require('../prompt/context')

// Lazy so Harness can require this module without a cycle.
const harnessModule = () => require('../harness/Harness')

export const log = (msg: string): void => { process.stdout.write(`[${new Date().toISOString()}] [plugins] ${msg}\n`) }

export const sessionWorkspace = (session: Session | null | undefined): Workspace | null => {
  if (!session) return null
  return session.workspaceId
    ? workspaceStore.loadWorkspace(session.workspaceId, config.writeDir)
    : workspaceStore.findWorkspaceByCwd(session.cwd, config.writeDir)
}

// The API plugins get, limited to one workspace. `source` is the session the
// plugin runs from; new sessions copy its provider and model unless told otherwise.
export const makeHarnessApi = (workspace: Workspace, source?: Session): HarnessApi => {
  const inWorkspace = (session: Session | null): Session => {
    if (!session) throw Object.assign(new Error('session not found'), { status: 404 })
    if (sessionWorkspace(session)?.id !== workspace.id) {
      throw Object.assign(new Error(`session ${session.id} is not in workspace ${workspace.id}`), { status: 403 })
    }
    return session
  }
  const loadSession = (sessionId: string): Session =>
    inWorkspace(require('../store/sessionStore').loadSession(sessionId, config.writeDir))

  const createSession = ({ provider, model, mode, name }: SessionOptions = {}): Session => {
      const Harness = harnessModule()
      const target = source
        ? Harness.resolveNewChatTarget(source, { provider, model, mode })
        : { provider: provider || 'cursor', model: model || null, mode: mode || 'agent' }
      const keepOptions = source && target.provider === source.provider && (target.model || null) === (source.model || null)
      if (name != null && typeof name !== 'string') throw new Error('session name must be a string')
      const entry = require('../registry').requireMode(workspace, target.mode, { provider: target.provider })
      if (entry.kind !== 'turn') throw new Error('new sessions must start with a core mode')
      const created = Harness.createSession({
        workspaceId: workspace.id,
        ...target,
        ...(keepOptions ? { codex: source.codex, grok: source.grok, claude: source.claude } : {}),
      })
      return mode != null || name != null
        ? require('../store/sessionStore').updateSession(created.id, {
          ...(mode != null ? { mode: target.mode } : {}), ...(name != null ? { name } : {}),
        }, config.writeDir) : created
  }
  const inspectRun: HarnessApi['runs']['inspect'] = (sessionId, runId) => {
    loadSession(sessionId)
    const run = require('../store/sessionStore').loadRun(sessionId, runId, config.writeDir)
    if (!run) throw Object.assign(new Error(`run not found: ${runId}`), { status: 404 })
    return run
  }
  const awaitRun: HarnessApi['runs']['await'] = async (sessionId, runId, { signal, timeoutMs } = {}) => {
    if (timeoutMs != null && (!Number.isFinite(timeoutMs) || timeoutMs < 0)) throw new Error('timeoutMs must be a nonnegative number')
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

