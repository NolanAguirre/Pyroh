const path = require('path')
const config = require('../config')
const paths = require('../store/paths')
const store = require('../store/sessionStore')
const locks = require('../store/sessionLock')
const { readJson, writeJson } = require('../store/jsonFile')
const { createDriver } = require('../agents/driver')
const registry = require('../registry')
const { createFork, readForkHistory } = require('./fork')
const { fingerprint } = require('./providerConfiguration')

const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }) }

const sourceConfiguration = (source, mode, runs) => {
  if (source.providerConfiguration) return source.providerConfiguration
  // Older sessions predate configuration snapshots. Reconstruct the Harness
  // configuration from their first prompt and current registry without replaying it.
  const { firedActions, triggerMcpServers } = require('../prompt/actions')
  const { findTriggers } = require('../prompt/triggers')
  const first = readForkHistory(source.id)?.runs?.[0] || runs[0]
  const list = registry.toolsFor(registry.sessionWorkspace(source), { mode, provider: source.provider })
  return {
    provider: source.provider,
    settings: { model: source.model, cwd: source.cwd, mode },
    tools: {
      list, askUserEnabled: list.includes('ask_user'),
      mcpServers: triggerMcpServers(firedActions(findTriggers(first?.prompt || '')), source),
      disableNativeSpawning: true,
      restrictedChild: Boolean(source.parentRunId) && mode !== 'agent',
    },
  }
}

// The caller holds an exclusive source lock until this resolves. A durable
// intent is written before provider I/O. An uncertain outcome is never retried
// blindly because neither transport promises idempotent fork creation.
const ensureNativeFork = async (source, { mode, workspaceId, prompt, retryKey, sessionFields }, writeDir = config.writeDir) => {
  if (!['codex', 'claude'].includes(source.provider)) fail(`Native forks are unavailable for ${source.provider}: its current transport has no confirmed fork support`, 400)
  if (!source.providerAgentId) fail('The source has no provider conversation to fork', 400)
  if (retryKey != null && (typeof retryKey !== 'string' || !retryKey.trim() || retryKey.length > 256)) fail('forkRetryKey must be a nonempty string of at most 256 characters', 400)
  const runs = store.listRuns(source.id, writeDir)
  const sourceRunId = runs.at(-1)?.id || null
  const requestHash = fingerprint({ prompt })
  const key = fingerprint(retryKey || { sourceProviderAgentId: source.providerAgentId, sourceRunId, prompt })
  const file = path.join(paths.sessionDir(source.id, writeDir), 'fork-requests', `${key}.json`)
  let request = readJson(file)
  if (request && request.requestHash !== requestHash) fail('This fork retry key belongs to a different message')
  if (!request) {
    const configuration = sourceConfiguration(source, mode, runs)
    const session = createFork(source, {
      workspaceId, ...sessionFields, mode,
      fork: { kind: 'native', state: 'prepared', cwd: configuration.settings.cwd || source.cwd,
        sourceProviderAgentId: source.providerAgentId, sourceConfiguration: configuration,
        configurationKnown: Boolean(source.providerConfiguration), requestKey: key },
    }, writeDir)
    request = { requestHash, sessionId: session.id, sourceRunId, sourceProviderAgentId: source.providerAgentId,
      state: 'prepared', createdAt: Date.now() }
    writeJson(file, request)
  }
  let session = store.loadSession(request.sessionId, writeDir)
  if (!session) fail('The saved fork session is missing; refusing to create another provider conversation')
  if (request.providerAgentId && session.providerAgentId === request.providerAgentId && session.fork.state === 'ready') {
    if (request.providerAgentId === request.sourceProviderAgentId) fail('Invalid fork: child provider ID matches its source')
    return { session, requestFile: file }
  }
  const save = (patch) => { request = { ...request, ...patch }; writeJson(file, request) }
  const lock = locks.acquire(session.id, writeDir, { exclusive: true })
  let driver
  try {
    if (request.providerAgentId) {
      if (request.providerAgentId === request.sourceProviderAgentId) fail('Invalid fork: child provider ID matches its source')
      if (session.providerAgentId && session.providerAgentId !== request.providerAgentId) fail('The saved fork provider ID changed; refusing to resume a different conversation')
      if (!session.providerAgentId) session = store.updateSession(session.id, {
        providerAgentId: request.providerAgentId, status: 'idle', fork: { ...session.fork, state: 'ready' },
      }, writeDir)
      return { session, requestFile: file }
    }
    if (request.state !== 'prepared') fail(`Native fork creation has an uncertain outcome for ${session.id}. It will not be repeated automatically; recover its provider ID before retrying.`)
    if (sourceRunId !== request.sourceRunId || source.providerAgentId !== request.sourceProviderAgentId) fail('The source changed before its native fork was created; this saved fork cannot move to a later point')
    const configuration = session.fork.sourceConfiguration
    const { askUserEnabled, ...tools } = configuration.tools
    driver = createDriver({
      provider: session.provider, writeDir, codex: session.codex, claude: session.claude,
      permissions: session.claudePermissions,
      tools: { ...tools, ...(askUserEnabled ? { askUser: async () => { throw new Error('A fork cannot request user input before its first turn') } } : {}) },
    })
    save({ state: 'creating', attemptStartedAt: Date.now() })
    store.updateSession(session.id, { fork: { ...session.fork, state: 'creating' } }, writeDir)
    const providerAgentId = await driver.fork(request.sourceProviderAgentId, configuration.settings)
    if (!providerAgentId || providerAgentId === request.sourceProviderAgentId) fail('The provider did not return an independent fork ID')
    // Journal first, then session: a crash between these writes is recoverable.
    save({ state: 'ready', providerAgentId, createdProviderAt: Date.now() })
    session = store.updateSession(session.id, {
      providerAgentId, status: 'idle', fork: { ...session.fork, state: 'ready' },
      providerConfiguration: configuration,
    }, writeDir)
    return { session, requestFile: file }
  } catch (err) {
    // Known pre-creation errors may be retried; timeouts/disconnects cannot.
    if (err.forkOutcome === 'not_created' && !request.providerAgentId) save({ state: 'prepared', error: err.message })
    store.updateSession(session.id, { lastError: { message: err.message, at: Date.now() } }, writeDir)
    throw err
  } finally {
    try { await driver?.close() } catch { /* the persisted child ID remains authoritative */ }
    lock.release()
  }
}

module.exports = { ensureNativeFork }
