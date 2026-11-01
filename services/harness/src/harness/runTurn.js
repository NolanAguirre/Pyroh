const config = require('../config')
const { createDriver, MEMORY_SERVER_NAME } = require('../agents/driver')
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
  terse = false,
  instructions,
}) => {
  const settings = { model: model || session.model, cwd: workspaceStore.resolveSessionCwd(session, writeDir), mode, tools }
  // Each daemon owns one session. Set its cwd before loading SDKs so shell
  // initialization and provider subprocesses inherit the workspace directory.
  process.chdir(settings.cwd)
  process.env.PWD = process.cwd()

  const sdkStoreDir = session.provider === 'cursor'
    ? await require('../store/cursorStore').prepare(session, writeDir, { fresh })
    : undefined
  const textOnly = Array.isArray(tools) && tools.length === 0
  // The MCP list is fixed when the driver is created, so steers on this turn
  // cannot fire trigger actions.
  const fired = textOnly ? [] : firedActions(findTriggers(prompt))
  const extraMcpServers = triggerMcpServers(fired, session)
  const makeDriver = () => createDriver({
    provider: session.provider,
    writeDir,
    sdkStoreDir,
    codex: session.codex,
    grok: session.grok,
    claude: session.claude,
    permissions: session.claudePermissions,
    onPermissions: (claudePermissions) => sessionStore.updateSession(session.id, { claudePermissions }, writeDir),
    tools: textOnly ? {} : driverTools({ askUser, harnessTools, session, extraMcpServers }),
  })
  let driver = makeDriver()
  let usage = null
  let durationMs = null

  try {
    if (signal?.aborted) return { result: { status: 'cancelled' }, providerAgentId: session.providerAgentId }
    if (session.providerAgentId && !fresh) {
      await driver.resume(session.providerAgentId, settings)
    } else {
      const sessionName = registry.builtinMode(session.mode)?.sessionName
      const named = session.provider === 'cursor' && sessionName ? { ...settings, name: sessionName } : settings
      await driver.create(named)
    }
    let providerAgentId = driver.providerAgentId()
    if (typeof onCreated === 'function') onCreated(providerAgentId)

    if (signal?.aborted) return { result: { status: 'cancelled' }, providerAgentId }
    // Persist snapshots separately from totals so reconnects retain the latest
    // context size, including decreases after compaction, in every run mode.
    const handleEvent = (event) => {
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

    const sendOptions = { mode, onEvent: handleEvent, outputSchema, instructions }
    const firstSendOptions = terse ? { ...sendOptions, terse: true } : sendOptions
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
        providerAgentId = driver.providerAgentId() || providerAgentId
        return driver.send(text, sendOptions)
      }
    }

    let text = await rewritePrompt(prompt, { cwd: settings.cwd })
    if (text !== prompt) onPromptRewrite?.(text)
    text = await prependNotes(fired, session, text)
    let first = true
    let result
    while (true) {
      const segmentStart = Date.now()
      const inflight = first ? await driver.send(text, firstSendOptions) : await sendFollowUp(text)
      first = false
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

      usage = addUsage(usage, segment.usage)
      durationMs = (durationMs || 0) + (segment.durationMs ?? Date.now() - segmentStart)
      result = { ...segment, usage, durationMs }

      if (!steering || signal?.aborted) break
      const steers = steering.take()
      if (!steers.length) break
      text = await rewritePrompt(steers.map((steer) => steer.text).join('\n\n'), { cwd: settings.cwd })
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
