const config = require('../config')
const workspaceStore = require('../store/workspaceStore')
const { TERSE_PROMPT, ASK_PROMPT } = require('../agents/modes')
const { transcriptDirectories } = require('../modes/tokenWaste')

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

  return {
    workspace,
    prompts: { terse: TERSE_PROMPT, ask: ASK_PROMPT },
    createSession: ({ provider, model } = {}) => {
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
    },
    run: (sessionId, { mode, prompt, provider, model } = {}) => {
      loadSession(sessionId)
      return harnessModule().run(sessionId, { mode, prompt, provider, model })
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
