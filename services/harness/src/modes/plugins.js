const fs = require('fs')
const path = require('path')
const config = require('../config')
const workspaceStore = require('../store/workspaceStore')
const { formatError } = require('../store/formatError')
const { AGENT_MODES, TERSE_PROMPT, ASK_PROMPT } = require('../agents/modes')
const { transcriptDirectories } = require('./tokenWaste')

// Workspace mode plugins: `<cwd>/harness.plugin.js` is trusted code, required
// straight into the harness and re-read on every use so edits apply at once.
const PLUGIN_FILE = 'harness.plugin.js'

const RUN_MODES = [...AGENT_MODES, 'token-waste', 'new-chat']
const RESERVED_MODES = [...RUN_MODES, 'decompose']
const MODE_ID = /^[a-z0-9][a-z0-9-]*$/

// Lazy so Harness can require this module without a cycle.
const harnessModule = () => require('../harness/Harness')

const log = (msg) => process.stdout.write(`[${new Date().toISOString()}] [plugins] ${msg}\n`)

const pluginFile = (cwd) => {
  if (!cwd) return null
  const file = path.join(path.resolve(cwd), PLUGIN_FILE)
  return fs.existsSync(file) ? file : null
}

const sessionWorkspace = (session) => {
  if (!session) return null
  return session.workspaceId
    ? workspaceStore.loadWorkspace(session.workspaceId, config.writeDir)
    : workspaceStore.findWorkspaceByCwd(session.cwd, config.writeDir)
}

const clearRequireCache = (cwd) => {
  const root = `${path.resolve(cwd)}${path.sep}`
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(root)) delete require.cache[key]
  }
}

// `source` is the session the plugin runs from; new sessions copy its provider
// and model unless told otherwise.
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

const normalizeMode = (mode, seen) => {
  if (!mode || typeof mode !== 'object') throw new Error('mode must be an object')
  const { id } = mode
  if (typeof id !== 'string' || !MODE_ID.test(id)) throw new Error(`invalid mode id: ${JSON.stringify(id)}`)
  if (RESERVED_MODES.includes(id)) throw new Error(`mode id clashes with a built-in: ${id}`)
  if (seen.has(id)) throw new Error(`duplicate mode id: ${id}`)
  seen.add(id)
  const base = mode.base || 'agent'
  if (!AGENT_MODES.includes(base)) throw new Error(`${id}: base must be one of ${AGENT_MODES.join(', ')}`)
  const instructions = mode.instructions
  if (instructions != null && typeof instructions !== 'string' && typeof instructions !== 'function') {
    throw new Error(`${id}: instructions must be a string or function`)
  }
  for (const key of ['buildPrompt', 'onComplete']) {
    if (mode[key] != null && typeof mode[key] !== 'function') throw new Error(`${id}: ${key} must be a function`)
  }
  for (const key of ['label', 'hint']) {
    if (mode[key] != null && typeof mode[key] !== 'string') throw new Error(`${id}: ${key} must be a string`)
  }
  return {
    id,
    label: mode.label || id,
    hint: mode.hint || '',
    base,
    terse: Boolean(mode.terse),
    promptOptional: Boolean(mode.promptOptional),
    newSession: Boolean(mode.newSession),
    instructions: instructions || null,
    buildPrompt: mode.buildPrompt || ((ctx) => ctx.prompt),
    onComplete: mode.onComplete || null,
  }
}

// A missing file has no modes. A broken file logs and also has none, so the
// workspace keeps working with the built-ins.
const loadModes = (workspace, harness) => {
  const file = pluginFile(workspace?.cwd)
  if (!file) return []
  try {
    clearRequireCache(workspace.cwd)
    const plugin = require(file)
    if (!plugin || typeof plugin.getModes !== 'function') throw new Error('module must export getModes()')
    const modes = plugin.getModes(harness || makeHarnessApi(workspace))
    if (!Array.isArray(modes)) throw new Error('getModes() must return an array')
    const seen = new Set()
    return modes.map((mode) => normalizeMode(mode, seen))
  } catch (err) {
    log(`failed to load ${file}: ${formatError(err)}`)
    return []
  }
}

const findMode = (workspace, id, harness) =>
  loadModes(workspace, harness).find((mode) => mode.id === id) || null

const describeModes = (workspace) =>
  loadModes(workspace).map(({ id, label, hint, base, promptOptional, newSession }) =>
    ({ id, label, hint, base, promptOptional, newSession }))

module.exports = {
  PLUGIN_FILE,
  RUN_MODES,
  RESERVED_MODES,
  pluginFile,
  sessionWorkspace,
  makeHarnessApi,
  loadModes,
  findMode,
  describeModes,
}
