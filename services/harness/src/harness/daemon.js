const fs = require('fs')
const path = require('path')
const config = require('../config')
const paths = require('../store/paths')
const { readJson, writeJson, ensureDir } = require('../store/jsonFile')
const sessionStore = require('../store/sessionStore')
const eventLog = require('../store/eventLog')
const questionStore = require('../store/questionStore')
const steerStore = require('../store/steerStore')
const { errorMessage, formatError } = require('../store/formatError')
const { failureStatus } = require('../store/networkError')
const { runOneTurn } = require('./runTurn')
const registry = require('../registry')
const analytics = require('../analytics/client')

const attachedLogs = new Set()

// Foreground runs tee to the log. Detached runs already inherit log descriptors.
// Writes are synchronous so the last error line is not lost on process.exit.
const attachLog = (sessionId, writeDir) => {
  const file = paths.daemonLog(sessionId, writeDir)
  if (process.env.HARNESS_LOG_FILE === file || attachedLogs.has(file)) return { end: () => {} }
  attachedLogs.add(file)
  ensureDir(path.dirname(file))
  const origOut = process.stdout.write.bind(process.stdout)
  const origErr = process.stderr.write.bind(process.stderr)
  const tee = (chunk, orig, rest) => {
    try {
      fs.appendFileSync(file, chunk)
    } catch {
      // ignore
    }
    return orig(chunk, ...rest)
  }
  process.stdout.write = (chunk, ...rest) => tee(chunk, origOut, rest)
  process.stderr.write = (chunk, ...rest) => tee(chunk, origErr, rest)
  return { end: () => {} }
}

const readControlIntent = (sessionId, writeDir) => {
  const control = readJson(paths.controlFile(sessionId, writeDir), null)
  return control && control.intent ? control.intent : null
}

const clearControl = (sessionId, writeDir) => {
  try {
    fs.rmSync(paths.controlFile(sessionId, writeDir), { force: true })
  } catch {
    // ignore
  }
}

const removePid = (sessionId, writeDir) => {
  try {
    fs.rmSync(paths.daemonPid(sessionId, writeDir), { force: true })
  } catch {
    // ignore
  }
}

// action: 'run' | 'plan' | 'resume'
const runDaemon = async ({ sessionId, runId, action, mode }) => {
  const writeDir = config.writeDir
  require('../store/sessionLock').acquire(sessionId, writeDir)
  const log = attachLog(sessionId, writeDir)
  const logLine = (msg) => process.stdout.write(`[${new Date().toISOString()}] ${msg}\n`)

  ensureDir(paths.sessionDir(sessionId, writeDir))
  // Steers are only accepted while a daemon pid is live; anything left over
  // belongs to an earlier daemon and must not interrupt this run.
  steerStore.takePending(sessionId, writeDir)
  writeJson(paths.daemonPid(sessionId, writeDir), {
    pid: process.pid, identity: require('../store/sessionLock').identity(), runId, startedAt: Date.now(),
  })

  const session = sessionStore.loadSession(sessionId, writeDir)
  if (!session) {
    logLine(`session not found: ${sessionId}`)
    removePid(sessionId, writeDir)
    process.exit(1)
  }

  let prompt
  try {
    prompt = sessionStore.readRunPrompt(sessionId, runId, writeDir)
  } catch (err) {
    logLine(`could not read prompt file: ${formatError(err)}`)
    removePid(sessionId, writeDir)
    process.exit(1)
  }
  if (prompt == null) {
    logLine(`prompt missing for run ${runId}`)
    removePid(sessionId, writeDir)
    process.exit(1)
  }

  // Plugin runs carry their driver mode, terse flag, and instructions. Built-in
  // modes come from the registry; unknown ones go to the driver as-is.
  const sourceRun = sessionStore.loadRun(sessionId, runId, writeDir)
  const plugin = sourceRun?.plugin || null
  const entry = registry.turnMode(mode, plugin)
  const driverMode = entry?.base || mode
  const workspace = registry.sessionWorkspace(session)
  if (plugin?.manifest) {
    registry.assertCompatiblePlugin(plugin, registry.requireMode(workspace, plugin.id, { provider: session.provider }))
  }
  const harnessTools = registry.toolsFor(workspace, { mode: plugin ? plugin.id : mode, provider: session.provider })

  const startedAt = Date.now()
  const abortController = new AbortController()
  let terminating = false
  let inflight = null
  // Replaced on every steer so questions from the interrupted step are cancelled.
  let questionAbort = new AbortController()

  // ask_user callback surfaced to the driver's custom tool.
  const askUser = async (question, { signal } = {}) => {
    // Provider stream resumes replay the pending tool call; reuse its question.
    const existing = questionStore.findPending(sessionId, runId, question.question, writeDir)
    const q = existing || { ...question, runId }
    const segmentSignal = questionAbort.signal
    if (!existing) {
      questionStore.writeQuestion(sessionId, q, writeDir)
      eventLog.append(sessionId, { type: 'question', ...q }, writeDir)
    }
    sessionStore.updateSession(sessionId, { status: 'awaiting_input' }, writeDir)
    logLine(`awaiting answer for question ${q.id}`)
    let answer
    try {
      answer = await questionStore.awaitAnswer(sessionId, q.id, writeDir, {
        signal: abortController.signal,
        signals: signal ? [signal, segmentSignal] : [segmentSignal],
      })
    } finally {
      if (!abortController.signal.aborted) sessionStore.updateSession(sessionId, { status: 'running' }, writeDir)
    }
    eventLog.append(sessionId, { type: 'status', status: 'running', runId }, writeDir)
    return answer
  }

  let capturedPlan = null
  const onEvent = (event) => {
    if (entry?.savePlan && event.type === 'tool_call' &&
      ['createplan', 'exitplanmode'].includes(String(event.name || '').toLowerCase()) &&
      typeof event.input?.plan === 'string') capturedPlan = event.input.plan
    eventLog.append(sessionId, { ...event, runId }, writeDir)
  }

  let parentWatch = null
  let exiting = false
  const finalize = (patch, sessionStatus, exitCode, sessionExtra = {}) => {
    if (exiting) return
    exiting = true
    clearInterval(parentWatch)
    try { require('./delegation').closeRun(sessionId, runId) }
    catch (err) { logLine(`child cleanup failed: ${formatError(err)}`) }
    try {
      sessionStore.updateRun(sessionId, runId, { endedAt: Date.now(), ...patch }, writeDir)
      questionStore.cancelPending(sessionId, runId, writeDir)
      if (sessionStatus) {
        sessionStore.updateSession(sessionId, { status: sessionStatus, ...sessionExtra }, writeDir)
      }
      clearControl(sessionId, writeDir)
      removePid(sessionId, writeDir)
    } catch (err) {
      logLine(`finalize failed: ${formatError(err)}`)
    }
    log.end()
    // Errored and cancelled runs count too; exit once the notify settles.
    analytics.notifySession(sessionId).finally(() => process.exit(exitCode))
  }

  const fail = (err, label, exitCode, patch = {}) => {
    const message = errorMessage(err)
    const status = failureStatus(err)
    logLine(`${label}${status === 'disconnected' ? ' (network lost)' : ''}: ${formatError(err)}`)
    try {
      onEvent({ type: 'error', message, stack: err?.stack })
    } catch {
      // keep going so the session is not left running
    }
    finalize({ ...patch, status, error: message }, status, exitCode, { lastError: { message, runId, at: Date.now() } })
  }

  // Provider sockets can reject outside the awaited chain when the network drops.
  process.on('uncaughtException', (err) => fail(err, 'crashed', 2))
  process.on('unhandledRejection', (reason) => fail(reason, 'crashed', 2))

  const onSignal = async () => {
    if (terminating) return
    terminating = true
    try { require('./delegation').stopChildren(sessionId, runId) }
    catch (err) { logLine(`child cleanup failed: ${formatError(err)}`) }
    const intent = readControlIntent(sessionId, writeDir) || 'paused'
    logLine(`received signal, intent=${intent}`)
    abortController.abort()
    if (inflight && typeof inflight.cancel === 'function') {
      await inflight.cancel()
    }
  }
  if (readControlIntent(sessionId, writeDir)) onSignal().catch(err => fail(err, 'stop failed', 2))
  if (session.parentRunId) {
    const checkParent = () => {
      if (sessionStore.loadSession(sessionId, writeDir)?.delegationDetached) return
      const delegation = require('./delegation')
      const allowed = session.childKind === 'workflow' ? delegation.workflowAllowed : delegation.parentAllowed
      if (!allowed(session.parentSessionId, session.parentRunId)) {
        writeJson(paths.controlFile(sessionId, writeDir), { intent: 'stop', at: Date.now() })
        onSignal().catch(err => fail(err, 'parent cleanup failed', 2))
      }
    }
    checkParent()
    parentWatch = setInterval(checkParent, 1000)
    parentWatch.unref()
  }
  process.on('SIGTERM', onSignal)
  process.on('SIGINT', onSignal)

  if (!terminating) sessionStore.updateSession(sessionId, { status: 'running' }, writeDir)
  let started = false
  let result
  try {
    if (session.parentRunId && !terminating) require('./delegation').assertChildRun(session, driverMode)
    const queuedMessage = sessionStore.loadRun(sessionId, runId, writeDir)?.queuedMessage
    // Beyond this boundary provider delivery may be ambiguous after a crash.
    // Keep the receipt and never automatically resend an attempted user turn.
    if (queuedMessage) sessionStore.updateRun(sessionId, runId, {
      queuedMessage: { ...queuedMessage, attemptStartedAt: Date.now() },
    }, writeDir)
    const turn = await runOneTurn({
      session,
      runId,
      writeDir,
      action,
      mode: entry || driverMode,
      prompt,
      images: sourceRun?.images,
      promptProvenance: sourceRun?.promptProvenance,
      outputSchema: sourceRun?.outputSchema,
      onEvent,
      askUser,
      harnessTools,
      signal: abortController.signal,
      steering: {
        watch: (onSteer) => steerStore.watch(sessionId, writeDir, onSteer),
        take: () => steerStore.takePending(sessionId, writeDir),
        onSteer: () => {
          logLine('steer received, interrupting current step')
          questionAbort.abort()
          questionAbort = new AbortController()
        },
      },
      onPromptRewrite: (text, promptProvenance) => {
        sessionStore.writeRunPrompt(sessionId, runId, text, writeDir)
        sessionStore.updateRun(sessionId, runId, { promptProvenance }, writeDir)
      },
      onInflight: (next) => {
        inflight = next
        if (next) sessionStore.updateRun(sessionId, runId, { providerRunId: next.providerRunId || next.runId }, writeDir)
      },
      onCreated: (providerAgentId) => {
        started = true
        logLine(
          session.providerAgentId
            ? `resuming agent ${session.providerAgentId}`
            : `creating ${session.provider} agent (model=${session.model || 'default'})`,
        )
        sessionStore.updateSession(
          sessionId,
          {
            providerAgentId: providerAgentId || session.providerAgentId,
            providerUsage: session.providerAgentId ? session.providerUsage : null,
            status: 'running',
            lastError: null,
          },
          writeDir,
        )
        sessionStore.updateRun(sessionId, runId, { pid: process.pid, status: 'running', providerAgentId }, writeDir)
        eventLog.append(sessionId, { type: 'status', status: 'running', runId }, writeDir)
      },
    })
    result = { ...turn.result, ...(capturedPlan ? { plan: capturedPlan } : {}) }
    sessionStore.updateRun(sessionId, runId, {
      transcriptStatus: result.transcriptStatus, transcriptError: result.transcriptError,
      ...(result.plan ? { plan: result.plan } : {}),
    }, writeDir)
    if (result.providerUsage) sessionStore.updateSession(sessionId, { providerUsage: result.providerUsage }, writeDir)
  } catch (err) {
    fail(err, `${started ? 'run' : 'startup'} failed`, started ? 2 : 1)
    return
  }

  const durationMs = result.durationMs || Date.now() - startedAt

  if (entry?.savePlan && (result.plan || result.result)) {
    sessionStore.writePlan(sessionId, runId, String(result.plan || result.result), writeDir)
  }

  sessionStore.addToTotals(sessionId, { runId, usage: result.usage, durationMs }, writeDir)

  if (terminating || result.status === 'cancelled') {
    const intent = readControlIntent(sessionId, writeDir) || 'paused'
    logLine(`terminated (${intent})`)
    finalize(
      { status: 'cancelled', usage: result.usage, durationMs, result: result.result },
      intent === 'stop' ? 'stopped' : 'paused',
      0,
    )
    return
  }

  if (result.status === 'error') {
    fail(result.error, 'run errored', 2, { usage: result.usage, durationMs, result: result.result })
    return
  }

  const failAfterRun = (err, label) => {
    const message = errorMessage(err)
    logLine(`${label}: ${formatError(err)}`)
    onEvent({ type: 'error', message, stack: err?.stack })
    finalize(
      { status: 'error', usage: result.usage, durationMs, error: message, result: result.result },
      'error',
      2,
      { lastError: { message, runId, at: Date.now() } },
    )
  }

  let handoff = {}
  // Legacy bundled runs have no descriptor. Resolve them through the same
  // completion hook as new runs; old handoff targets become ordinary options.
  if (plugin || entry?.kind === 'plugin') {
    const id = plugin?.id || entry.id
    try {
      const harness = workspace && registry.makeHarnessApi(workspace, session)
      const def = workspace && registry.findMode(workspace, id, { harness })
      if (!def) throw new Error(`plugin mode ${id} is unavailable`)
      registry.assertCompatiblePlugin(plugin, def)
      if (def.onComplete) {
        const sourceSessionId = plugin?.sourceSessionId || (def.newSession ? session.sourceSessionId : session.id)
        const sourceSession = sourceSessionId && sourceSessionId !== session.id
          ? harness.sessions.inspect(sourceSessionId) : session
        const options = plugin?.options || (sourceRun?.handoff ? {
          provider: sourceRun.handoff.provider, model: sourceRun.handoff.model, targetMode: sourceRun.handoff.mode,
        } : {})
        const completion = await def.onComplete({
          workspace, session, sourceSession, runId, prompt,
          promptProvenance: sourceRun?.promptProvenance, options,
        }, result, harness)
        if (completion?.continuation) {
          const next = completion.continuation
          onEvent({ type: 'handoff', session: next.session, handoffRunId: next.run.id })
          handoff = { handoffSessionId: next.session.id, handoffRunId: next.run.id }
        }
      }
    } catch (err) {
      failAfterRun(err, `${id} onComplete failed`)
      return
    }
  }

  logLine(`run finished: ${result.status}`)
  let waiting = false
  try { waiting = require('./delegation').hasPendingChildren(sessionId) }
  catch (err) { logLine(`child check failed: ${formatError(err)}`) }
  finalize(
    { status: 'completed', usage: result.usage, durationMs, result: result.result, ...handoff },
    waiting ? 'subagent' : 'idle',
    0,
  )
}

module.exports = { runDaemon, attachLog, readControlIntent, clearControl, removePid }
