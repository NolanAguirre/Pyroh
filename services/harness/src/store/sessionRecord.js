const fs = require('fs')
const crypto = require('crypto')
const paths = require('./paths')
const workspaceStore = require('./workspaceStore')
const sessionIndex = require('./sessionIndex')
const { readJson, readJsonAsync, writeJson, ensureDir } = require('./jsonFile')
const { listProviders } = require('../agents/driver')
const { normalizeCodexOptions } = require('../agents/providers/codexOptions')
const { normalizeGrokOptions } = require('../agents/providers/grokOptions')
const { normalizeClaudeOptions } = require('../agents/providers/claudeOptions')
const { withAncestry, withAncestryAsync } = require('./sessionAncestry')

const genId = (prefix) => `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`

const emptyTotals = () => ({
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 },
  durationMs: 0,
})

const persistableSession = (session) => {
  const { logPath, eventsPath, ...stored } = session
  return stored
}

const withCwd = (session, cwd, writeDir) => ({
  ...persistableSession(session),
  cwd,
  logPath: paths.daemonLog(session.id, writeDir),
  eventsPath: paths.eventsFile(session.id, writeDir),
})

const withResolvedCwd = (session, writeDir) => {
  if (!session) return session
  return withCwd(session, workspaceStore.resolveSessionCwd(session, writeDir), writeDir)
}

const withResolvedCwdAsync = async (session, writeDir, workspaces) => {
  if (!session) return session
  return withCwd(session, await workspaceStore.resolveSessionCwdAsync(session, writeDir, workspaces), writeDir)
}

const writeSession = (next, writeDir) => {
  next = withAncestry(next, writeDir)
  const file = paths.sessionFile(next.id, writeDir)
  writeJson(file, next)
  sessionIndex.upsert(next, fs.statSync(file).mtimeMs, writeDir)
  return next
}

const createSession = ({ workspaceId, provider, model, codex, grok, claude }, writeDir) => {
  if (!listProviders().includes(provider)) throw new Error(`unknown provider: ${provider}`)
  const providerOptions = provider === 'codex' ? { codex: normalizeCodexOptions(codex) }
    : provider === 'grok' ? { grok: normalizeGrokOptions(grok) }
      : provider === 'claude' ? { claude: normalizeClaudeOptions(claude) }
        : {}
  if (!workspaceId) throw new Error('workspaceId is required')
  const workspace = workspaceStore.loadWorkspace(workspaceId, writeDir)
  if (!workspace) throw new Error(`workspace not found: ${workspaceId}`)
  const id = genId('s')
  const now = Date.now()
  paths.rememberSession(id, workspaceId, writeDir)
  const session = {
    id,
    parentSessionId: null,
    rootSessionId: id,
    lineage: [],
    depth: 0,
    workspaceId,
    provider,
    model: model || null,
    ...providerOptions,
    cwd: workspace.cwd,
    providerAgentId: null,
    name: null,
    status: 'idle',
    archived: false,
    pinned: false,
    totals: emptyTotals(),
    createdAt: now,
    updatedAt: now,
  }
  writeSession(session, writeDir)
  ensureDir(paths.runsDir(id, writeDir))
  ensureDir(paths.questionsDir(id, writeDir))
  return withResolvedCwd(session, writeDir)
}

const loadSession = (sessionId, writeDir) =>
  withResolvedCwd(withAncestry(readJson(paths.sessionFile(sessionId, writeDir), null), writeDir), writeDir)

const loadSessionAsync = async (sessionId, writeDir, workspaces) =>
  withResolvedCwdAsync(await withAncestryAsync(await readJsonAsync(paths.sessionFile(sessionId, writeDir), null), writeDir), writeDir, workspaces)

const updateSession = (sessionId, patch, writeDir) => {
  const session = loadSession(sessionId, writeDir)
  if (!session) throw new Error(`session not found: ${sessionId}`)
  const next = withAncestry(persistableSession({ ...session, ...patch, updatedAt: Date.now() }), writeDir)
  writeSession(next, writeDir)
  return withResolvedCwd(next, writeDir)
}

module.exports = {
  genId,
  emptyTotals,
  persistableSession,
  withCwd,
  withResolvedCwd,
  writeSession,
  createSession,
  loadSession,
  loadSessionAsync,
  updateSession,
}
