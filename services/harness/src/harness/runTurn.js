const config = require('../config')
const { createDriver, MEMORY_SERVER_NAME } = require('../agents/driver')
const { AGENT_MODES } = require('../agents/modes')
const registry = require('../registry')
const workspaceStore = require('../store/workspaceStore')
const paths = require('../store/paths')
const sessionStore = require('../store/sessionStore')
const { rewritePrompt } = require('../prompt/rewrite')
const { findTriggers } = require('../prompt/triggers')
const { firedActions, triggerMcpServers, prependNotes } = require('../prompt/actions')

const addUsage = (total, usage) => {
  if (!usage) return total
  if (!total) return { ...usage }
  const sum = { ...total }
  for (const [key, value] of Object.entries(usage)) {
    if (typeof value === 'number') sum[key] = (typeof sum[key] === 'number' ? sum[key] : 0) + value
  }
  return sum
}

// mcp-memory files memories by the URL path, so each extraction session gets
// its own route under the source session it reads.
const memoryServer = (session) => {
  if (!config.memoryMcpUrl) throw new Error('create_memory needs HARNESS_MEMORY_MCP_URL (the mcp-memory service)')
  if (!session.sourceSessionId) throw new Error('create_memory needs a session with a sourceSessionId')
  const route = [session.sourceSessionId, session.id].map(encodeURIComponent).join('/')
  return { name: MEMORY_SERVER_NAME, url: `${config.memoryMcpUrl}/mcp/${route}` }
}

// Harness tools for the driver: `list` holds the allowed ids, and each tool's
// callback is only present when it is allowed. Providers deliver them their own way.
// `mcpServers` ({ name, url }) holds the MCP-delivered tools; `extraMcpServers`
// come from prompt trigger actions.
const driverTools = ({ askUser, harnessTools, session, extraMcpServers = [] }) => {
  const list = Array.isArray(harnessTools) ? harnessTools : typeof askUser === 'function' ? ['ask_user'] : []
  const tools = { list }
  const mcpServers = [...extraMcpServers]
  if (list.includes('ask_user') && typeof askUser === 'function') tools.askUser = askUser
  if (list.includes('create_memory')) mcpServers.push(memoryServer(session))
  if (mcpServers.length) tools.mcpServers = mcpServers
  return tools
}

// One agent turn: create (or resume) a driver, send a prompt, stream events,
// wait for the result, then close. Callers persist runs, plans, and session
// status around this helper.
//
// steering: { watch(onSteer) => stop, take() => steers, onSteer? }. A steer
// cancels the in-flight send; the steer text is then sent on the same
// conversation, and the turn result covers every segment.
//
// harnessTools: registry tool ids allowed this turn. Omitted means every
// harness tool with a callback here (ask_user when askUser is given).
const runOneTurn = async ({
  session,
  runId,
  writeDir,
  action,
  mode,
  plugin,
  prompt,
  model,
  tools,
  outputSchema,
  signal,
  onEvent,
  askUser,
  harnessTools,
  onCreated,
  onInflight,
  onPromptRewrite,
  steering,
  fresh = false,
  terse,
  instructions,
  delegationEligible,
}) => {
  const entry = registry.turnMode(mode ?? session.mode, plugin)
  mode = entry?.base || mode || session.mode
  const primitive = AGENT_MODES.includes(mode)
  const nativeFork = session.fork?.kind === 'native'
  if (nativeFork && (fresh || session.fork.state !== 'ready' || !session.providerAgentId || session.providerAgentId === session.fork.sourceProviderAgentId || session.provider !== session.fork.sourceConfiguration?.provider)) {
    throw new Error('Native forks require their saved child provider thread; fresh creation and transcript replay are unavailable')
  }
  const first = !session.fork && (!session.providerAgentId || fresh)
  terse = terse === undefined ? first && Boolean(entry?.terse) : terse
  if (instructions === undefined) instructions = nativeFork && session.fork.sourceConfiguration?.settings.mode === mode
    ? session.fork.sourceConfiguration.instructions ?? entry?.instructions : entry?.instructions
  if (outputSchema === undefined && nativeFork && session.fork.sourceConfiguration?.settings.mode === mode) {
    outputSchema = session.fork.sourceConfiguration.outputSchema
  }
  const child = Boolean(session.parentRunId) && session.childKind !== 'workflow'
  const managed = primitive || child
  const depth = session.depth ?? sessionStore.loadSession(session.id, writeDir)?.depth ?? 0
  const delegation = require('./delegation')
  const delegationSession = { ...session, depth }
  const eligible = primitive && (delegationEligible ?? entry?.delegationEligible ?? true)
  const canDelegate = eligible && delegation.canSpawn(delegationSession)
  const canManageChildren = eligible && delegation.canDelegate(delegationSession) && delegation.hasPendingChildren(session.id)
  const inheritedConfiguration = nativeFork ? session.fork.sourceConfiguration : null
  if (tools === undefined && inheritedConfiguration?.settings.tools !== undefined) tools = inheritedConfiguration.settings.tools
  const settings = { model: model || session.model || inheritedConfiguration?.settings.model, cwd: workspaceStore.resolveSessionCwd(session, writeDir), mode, tools,
    ...(nativeFork ? { requireExisting: true, reasoningEffort: inheritedConfiguration?.settings.reasoningEffort } : {}) }
  // Each daemon owns one session. Set its cwd before loading SDKs so shell
  // initialization and provider subprocesses inherit the workspace directory.
  process.chdir(settings.cwd)
  process.env.PWD = process.cwd()

  const sdkStoreDir = session.provider === 'cursor'
    ? await require('../store/cursorStore').prepare(session, writeDir, { fresh })
    : undefined
  const textOnly = Array.isArray(tools) && tools.length === 0
  // Trigger actions fire only on the first prompt to a new agent or subagent.
  const fired = textOnly || !first ? [] : firedActions(findTriggers(prompt))
  const previousTools = session.providerConfiguration?.tools
  const extraMcpServers = [...(previousTools?.mcpServers || []).filter(server => !['harness_agents', MEMORY_SERVER_NAME].includes(server.name))]
  for (const server of triggerMcpServers(fired, session)) {
    if (!extraMcpServers.some(previous => previous.name === server.name)) extraMcpServers.push(server)
  }
  if ((canDelegate || canManageChildren) && !textOnly) extraMcpServers.push(delegation.open(session, runId, mode))
  if (managed && session.provider === 'grok') onEvent?.({ type: 'status', status: 'Native spawning cannot be fully blocked by Grok; harness-only delegation is instructed.' })
  const allowedTools = inheritedConfiguration?.tools.list && Array.isArray(harnessTools)
    ? inheritedConfiguration.tools.list.filter(id => harnessTools.includes(id)) : harnessTools
  const configuredTools = {
    ...(textOnly ? {} : driverTools({ askUser, harnessTools: allowedTools, session, extraMcpServers })),
    disableNativeSpawning: managed || Boolean(inheritedConfiguration?.tools.disableNativeSpawning),
    restrictedChild: (child && mode !== 'agent') || Boolean(inheritedConfiguration?.tools.restrictedChild),
  }
  const configuration = require('./providerConfiguration').snapshot(session.provider, settings, configuredTools, { instructions, outputSchema })
  sessionStore.updateSession(session.id, { providerConfiguration: configuration }, writeDir)
  if (nativeFork) {
    const comparison = require('./providerConfiguration').compare(session.fork.configurationKnown ? inheritedConfiguration : null, configuration)
    const cacheConfiguration = { ...comparison, runId, updatedAt: Date.now() }
    sessionStore.updateSession(session.id, { cacheConfiguration }, writeDir)
    if (runId) sessionStore.updateRun(session.id, runId, { cacheConfiguration }, writeDir)
    onEvent?.({ type: 'cache_configuration', ...cacheConfiguration })
  }
  const makeDriver = () => createDriver({
    provider: session.provider,
    writeDir,
    sdkStoreDir,
    codex: session.codex,
    grok: session.grok,
    claude: session.claude,
    permissions: session.claudePermissions,
    onPermissions: (claudePermissions) => sessionStore.updateSession(session.id, { claudePermissions }, writeDir),
    tools: configuredTools,
  })
  let driver = makeDriver()
  let usage = null
  let durationMs = null

  try {
    if (signal?.aborted) return { result: { status: 'cancelled' }, providerAgentId: session.providerAgentId }
    if (session.fork && fresh) sessionStore.updateSession(session.id, { forkHistorySeed: null }, writeDir)
    if (session.providerAgentId && !fresh) {
      await driver.resume(session.providerAgentId, settings)
    } else {
      const sessionName = registry.builtinMode(session.mode)?.sessionName
      const named = session.provider === 'cursor' && sessionName ? { ...settings, name: sessionName } : settings
      await driver.create(named)
    }
    let providerAgentId = driver.providerAgentId()
    if (nativeFork && providerAgentId !== session.providerAgentId) throw new Error('Native fork resume returned a different provider thread')
    configuration.settings = { ...configuration.settings, ...driver.resolvedSettings?.() }
    sessionStore.updateSession(session.id, { providerConfiguration: configuration }, writeDir)
    if (typeof onCreated === 'function') onCreated(providerAgentId)

    if (signal?.aborted) return { result: { status: 'cancelled' }, providerAgentId }
    const seed = session.fork ? sessionStore.loadSession(session.id, writeDir)?.forkHistorySeed : null
    let needsHistory = Boolean(session.fork) && !nativeFork && (fresh || !seed
      || seed.provider !== session.provider || seed.providerAgentId !== providerAgentId)
    let historySent = false
    let historyObserved = false
    const markHistorySeeded = () => {
      if (!needsHistory || !historySent) return
      providerAgentId = driver.providerAgentId() || providerAgentId
      sessionStore.updateSession(session.id, {
        forkHistorySeed: { provider: session.provider, providerAgentId },
      }, writeDir)
      needsHistory = false
    }
    // Persist snapshots separately from totals so reconnects retain the latest
    // context size, including decreases after compaction, in every run mode.
    const handleEvent = (event) => {
      if (event.type === 'provider_settings') {
        configuration.settings = { ...configuration.settings, ...event.settings }
        sessionStore.updateSession(session.id, { providerConfiguration: configuration }, writeDir)
        return
      }
      // Some drivers return an inflight handle even when the request failed.
      // Provider output confirms acceptance, including turns later cancelled.
      if (needsHistory && ['text', 'thinking', 'tool_call', 'question'].includes(event.type)) {
        historyObserved = true
        markHistorySeeded()
      }
      if (event.type === 'context' && event.context) {
        const { usedTokens, maxTokens, status } = event.context
        const context = {
          usedTokens: Number.isFinite(usedTokens) && usedTokens >= 0 ? usedTokens : null,
          maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : null,
          status: status || 'reported',
          updatedAt: Date.now(),
          runId,
          providerAgentId,
        }
        sessionStore.updateSession(session.id, { context }, writeDir)
        onEvent?.({ ...event, context })
        return
      }
      onEvent?.(event)
    }
    if (session.context && session.context.providerAgentId !== providerAgentId) {
      sessionStore.updateSession(session.id, { context: null }, writeDir)
    }

    const managedInstructions = managed
      ? [
        instructions,
        delegation.guidance(session.provider, child, { session: delegationSession, canDelegate: canDelegate && !textOnly }),
        canManageChildren && !canDelegate && !textOnly && 'Existing children may still finish. Use harness_agents status/wait/stop to manage them; spawning is unavailable. If their results are needed, end this turn with a brief pending-work update. Their results will resume you automatically unless spawned with dontReturn: true. Do not poll or wait in a loop.',
      ].filter(Boolean).join('\n\n')
      : instructions
    const sendOptions = { mode, onEvent: handleEvent, outputSchema, instructions: managedInstructions }
    const firstSendOptions = { ...sendOptions }
    if (terse) firstSendOptions.terse = true
    // Codex and Grok drop their transport when a cancel overruns its grace
    // period, so a follow-up send may need a fresh driver on the same agent.
    const sendFollowUp = async (text) => {
      try {
        return await driver.send(text, sendOptions)
      } catch (err) {
        if (signal?.aborted) throw err
        try {
          await driver.close()
        } catch {
          // transport already gone
        }
        driver = makeDriver()
        await driver.resume(providerAgentId, settings)
        if (nativeFork && driver.providerAgentId() !== providerAgentId) throw new Error('Native fork reconnect returned a different provider thread')
        providerAgentId = driver.providerAgentId() || providerAgentId
        return driver.send(text, sendOptions)
      }
    }

    let text = await rewritePrompt(prompt, { cwd: settings.cwd, first, provider: session.provider })
    if (text !== prompt) onPromptRewrite?.(text)
    text = await prependNotes(fired, session, text)
    let firstSend = true
    let result
    while (true) {
      const segmentStart = Date.now()
      let sendText = text
      if (needsHistory) {
        const history = require('./fork').historyPrompt(session.id, writeDir)
        if (typeof history !== 'string' || !history.trim()) throw new Error(`Fork history unavailable: ${session.id}`)
        sendText = `${history}\n\n${text}`
        historySent = false
        historyObserved = false
      }
      const inflight = firstSend ? await driver.send(sendText, firstSendOptions) : await sendFollowUp(sendText)
      historySent = true
      if (historyObserved) markHistorySeeded()
      firstSend = false
      if (typeof onInflight === 'function') onInflight(inflight)
      if (signal?.aborted) await inflight.cancel()

      let steered = false
      const stopWatch = steering && !signal?.aborted
        ? steering.watch(() => {
          if (steered) return
          steered = true
          steering.onSteer?.()
          Promise.resolve(inflight.cancel()).catch(() => {})
        })
        : null
      let segment
      try {
        segment = await inflight.wait()
      } finally {
        stopWatch?.()
      }
      if (segment.status === 'completed') markHistorySeeded()

      usage = addUsage(usage, segment.usage)
      durationMs = (durationMs || 0) + (segment.durationMs ?? Date.now() - segmentStart)
      result = { ...segment, usage, durationMs }

      if (!steering || signal?.aborted) break
      const steers = steering.take()
      if (!steers.length) break
      const steerText = steers.map((steer) => steer.text).join('\n\n')
      text = await rewritePrompt(steerText, { cwd: settings.cwd, first: false, provider: session.provider })
      onEvent?.({ type: 'user', steer: true, text, itemId: `steer:${steers[0].id}` })
      if (signal?.aborted) break
    }

    if (runId) {
      const path = require('path')
      require('../store/jsonFile').writeJson(path.join(paths.sessionDir(session.id, writeDir), 'receipts', `${runId}.json`), {
        ...result, runId, providerAgentId, endedAt: Date.now(),
      })
    }
    return { result, providerAgentId }
  } catch (err) {
    if (signal?.aborted) return { result: { status: 'cancelled', usage, durationMs }, providerAgentId: driver.providerAgentId() }
    throw err
  } finally {
    await driver.close()
    if (typeof onInflight === 'function') onInflight(null)
  }
}

module.exports = { runOneTurn }
