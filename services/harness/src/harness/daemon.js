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
const newChat = require('../modes/newChat')
const { TERSE_MODES } = require('../agents/modes')
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
  const handingOff = mode === newChat.MODE
  const analyzing = mode === 'token-waste' || handingOff
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

  // Plugin runs carry their driver mode, terse flag, and instructions.
  const plugin = sessionStore.loadRun(sessionId, runId, writeDir)?.plugin || null
  const driverMode = plugin ? plugin.base : analyzing ? 'plan' : mode

  const startedAt = Date.now()
  const abortController = new AbortController()
  let terminating = false
  let inflight = null
  // Replaced on every steer so questions from the interrupted step are cancelled.
  let questionAbort = new AbortController()

  // ask_user callback surfaced to the driver's custom tool.
  const askUser = async (question, { signal } = {}) => {
    const q = { ...question, runId }
    const segmentSignal = questionAbort.signal
    questionStore.writeQuestion(sessionId, q, writeDir)
    eventLog.append(sessionId, { type: 'question', ...q }, writeDir)
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

  const onEvent = (event) => {
    eventLog.append(sessionId, { ...event, runId }, writeDir)
  }

  let exiting = false
  const finalize = (patch, sessionStatus, exitCode, sessionExtra = {}) => {
    if (exiting) return
    exiting = true
    try {
      sessionStore.updateRun(sessionId, runId, { endedAt: Date.now(), ...patch }, writeDir)
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
      onEvent({ type: 'error', message })
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
    const intent = readControlIntent(sessionId, writeDir) || 'paused'
    logLine(`received signal, intent=${intent}`)
    abortController.abort()
    if (inflight && typeof inflight.cancel === 'function') {
      await inflight.cancel()
    }
  }
  process.on('SIGTERM', onSignal)
  process.on('SIGINT', onSignal)

  let started = false
  let result
  try {
    const turn = await runOneTurn({
      session,
      runId,
      writeDir,
      action,
      mode: driverMode,
      prompt,
      terse: !session.providerAgentId && (plugin ? plugin.terse : TERSE_MODES.includes(mode)),
      instructions: plugin?.instructions || undefined,
      onEvent,
      askUser,
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
      onPromptRewrite: (text) => sessionStore.writeRunPrompt(sessionId, runId, text, writeDir),
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
        sessionStore.updateRun(sessionId, runId, {
          pid: process.pid, status: 'running', providerAgentId,
          ...(session.provider === 'cursor' ? { transcriptFile: `${runId}.cursor.jsonl` } : {}),
        }, writeDir)
        eventLog.append(sessionId, { type: 'status', status: 'running', runId }, writeDir)
      },
    })
    result = turn.result
    sessionStore.updateRun(sessionId, runId, {
      transcriptStatus: result.transcriptStatus, transcriptError: result.transcriptError,
    }, writeDir)
    if (result.providerUsage) sessionStore.updateSession(sessionId, { providerUsage: result.providerUsage }, writeDir)
  } catch (err) {
    fail(err, `${started ? 'run' : 'startup'} failed`, started ? 2 : 1)
    return
  }

  const durationMs = result.durationMs || Date.now() - startedAt

  if ((plugin ? plugin.base : mode) === 'plan' && result.result) {
    sessionStore.writePlan(sessionId, runId, String(result.result), writeDir)
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
    onEvent({ type: 'error', message })
    finalize(
      { status: 'error', usage: result.usage, durationMs, error: message, result: result.result },
      'error',
      2,
      { lastError: { message, runId, at: Date.now() } },
    )
  }

  let handoff = {}
  if (handingOff) {
    const continuation = String(result.result || '').trim()
    try {
      if (!continuation) throw new Error('new chat: agent returned no continuation prompt')
      const sourceRun = sessionStore.loadRun(sessionId, runId, writeDir)
      const next = require('./Harness').continueInNewChat(sessionId, continuation, sourceRun && sourceRun.handoff)
      logLine(`continuing in new session ${next.session.id} (run ${next.run.id})`)
      onEvent({ type: 'handoff', session: next.session, handoffRunId: next.run.id })
      handoff = { handoffSessionId: next.session.id, handoffRunId: next.run.id }
    } catch (err) {
      failAfterRun(err, 'handoff failed')
      return
    }
  }

  // Reload the plugin so onComplete sees the latest file.
  if (plugin) {
    try {
      const plugins = require('../modes/plugins')
      const workspace = plugins.sessionWorkspace(session)
      const harness = workspace && plugins.makeHarnessApi(workspace, session)
      const def = workspace && plugins.findMode(workspace, plugin.id, harness)
      if (!def) logLine(`plugin mode ${plugin.id} not found; skipping onComplete`)
      else if (def.onComplete) await def.onComplete({ workspace, session, runId, prompt }, result, harness)
    } catch (err) {
      failAfterRun(err, `${plugin.id} onComplete failed`)
      return
    }
  }

  logLine(`run finished: ${result.status}`)
  finalize(
    { status: 'completed', usage: result.usage, durationMs, result: result.result, ...handoff },
    'idle',
    0,
  )
}

module.exports = { runDaemon, attachLog, readControlIntent, clearControl, removePid }
