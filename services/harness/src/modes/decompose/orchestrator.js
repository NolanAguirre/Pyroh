const config = require('../../config')
const paths = require('../../store/paths')
const { writeJson, ensureDir } = require('../../store/jsonFile')
const sessionStore = require('../../store/sessionStore')
const eventLog = require('../../store/eventLog')
const questionStore = require('../../store/questionStore')
const { errorMessage, formatError } = require('../../store/formatError')
const { failureStatus } = require('../../store/networkError')
const { snapshotIfGitRepo } = require('../../store/gitSnapshot')
const workspaceStore = require('../../store/workspaceStore')
const { runOneTurn } = require('../../harness/runTurn')
const { attachLog, readControlIntent, clearControl, removePid } = require('../../harness/daemon')
const analytics = require('../../analytics/client')
const registry = require('../../registry')
const {
  onceSteps,
  eachPhaseSteps,
  promptFor,
  parseStepOutput,
  nextProgress,
  shouldSkip,
} = require('./pipeline')

const PLAN_TOOLS = new Set(['createplan', 'exitplanmode'])

const planFromToolCall = (event) => {
  if (event.type !== 'tool_call') return null
  if (!PLAN_TOOLS.has(String(event.name || '').toLowerCase())) return null
  return typeof event.input?.plan === 'string' ? event.input.plan : null
}

const runDecomposeDaemon = async ({ sessionId, resume = false }) => {
  const writeDir = config.writeDir
  require('../../store/sessionLock').acquire(sessionId, writeDir)
  const log = attachLog(sessionId, writeDir)
  const logLine = (msg) => process.stdout.write(`[${new Date().toISOString()}] ${msg}\n`)

  ensureDir(paths.sessionDir(sessionId, writeDir))
  writeJson(paths.daemonPid(sessionId, writeDir), {
    pid: process.pid,
    identity: require('../../store/sessionLock').identity(),
    kind: 'decompose',
    startedAt: Date.now(),
  })

  const session = sessionStore.loadSession(sessionId, writeDir)
  const sourcePlan = sessionStore.readSourcePlan(sessionId, writeDir)

  const abortController = new AbortController()
  let terminating = false
  let exiting = false
  let inflight = null
  let activeRunId = null
  let activePhase = 0
  let activeStepId = null

  const askUser = async (question, { signal } = {}) => {
    const q = { ...question, runId: activeRunId, phase: activePhase, step: activeStepId }
    questionStore.writeQuestion(sessionId, q, writeDir)
    eventLog.append(sessionId, { type: 'question', ...q }, writeDir)
    sessionStore.updateSession(sessionId, { status: 'awaiting_input' }, writeDir)
    logLine(`awaiting answer for question ${q.id}`)
    let answer
    try {
      answer = await questionStore.awaitAnswer(sessionId, q.id, writeDir, {
        signal: abortController.signal,
        signals: signal ? [signal] : [],
      })
    } finally {
      if (!abortController.signal.aborted) sessionStore.updateSession(sessionId, { status: 'running' }, writeDir)
    }
    eventLog.append(
      sessionId,
      { type: 'status', status: 'running', runId: activeRunId, phase: activePhase, step: activeStepId },
      writeDir,
    )
    return answer
  }

  const lastErrorPatch = (err, extra = {}) => ({
    lastError: {
      message: errorMessage(err),
      phase: extra.phase == null ? null : extra.phase,
      step: extra.step || null,
      runId: extra.runId || null,
      at: Date.now(),
    },
  })

  const finalize = (sessionStatus, exitCode, extra = {}) => {
    if (exiting) return
    exiting = true
    try {
      if (sessionStatus) {
        sessionStore.updateSession(sessionId, { status: sessionStatus, ...extra }, writeDir)
      }
      clearControl(sessionId, writeDir)
      removePid(sessionId, writeDir)
    } catch (err) {
      logLine(`finalize failed: ${formatError(err)}`)
    }
    log.end()
    // Covers failed steps and lets a step notify still in flight land before exit.
    analytics.notifySession(sessionId).finally(() => process.exit(exitCode))
  }

  const fail = (err, extra = {}, exitCode = 2) => {
    const message = errorMessage(err)
    const prefix = extra.prefix ? `${extra.prefix}: ` : ''
    logLine(`${prefix}${formatError(err)}`)
    if (extra.emit !== false) {
      try {
        eventLog.append(
          sessionId,
          {
            type: 'error',
            message,
            runId: extra.runId || activeRunId,
            phase: extra.phase == null ? activePhase : extra.phase,
            step: extra.step || activeStepId,
          },
          writeDir,
        )
      } catch (appendErr) {
        logLine(`failed to append error event: ${formatError(appendErr)}`)
      }
    }
    finalize(failureStatus(err), exitCode, lastErrorPatch(err, extra))
  }

  if (!session) {
    fail(`session not found: ${sessionId}`, {}, 1)
    return
  }
  if (!sourcePlan) {
    fail('source-plan.md is missing', {}, 1)
    return
  }

  process.on('uncaughtException', (err) => {
    fail(err, { runId: activeRunId, phase: activePhase, step: activeStepId }, 1)
  })
  process.on('unhandledRejection', (reason) => {
    fail(reason, { runId: activeRunId, phase: activePhase, step: activeStepId }, 1)
  })

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

  const progress = () => {
    const live = sessionStore.loadSession(sessionId, writeDir) || session
    return {
      currentPhase: live.currentPhase == null ? null : live.currentPhase,
      currentStep: live.currentStep == null ? null : live.currentStep,
      totalPhases: live.totalPhases == null ? null : live.totalPhases,
    }
  }

  const runStep = async ({ step, phase, totalPhases, sourcePlan: planText }) => {
    step = { ...step, ...step.providers?.[session.provider] }
    const startedAt = Date.now()
    const runId = sessionStore.genId('r')
    activeRunId = runId
    activePhase = phase
    activeStepId = step.id

    sessionStore.updateSession(
      sessionId,
      {
        mode: 'decompose',
        status: 'running',
        currentPhase: phase,
        currentStep: step.id,
        totalPhases: totalPhases || null,
      },
      writeDir,
    )

    const vars = {
      sourcePlan: planText,
      currentPhase: phase,
      totalPhases: totalPhases || '',
      planBody: phase ? sessionStore.readPhasePlan(sessionId, phase, writeDir) || '' : '',
    }
    const prompt = promptFor(step, vars)
    const model = step.model || session.model
    const mode = step.agentMode || 'agent'

    const record = sessionStore.writeStepRun(
      sessionId,
      { phase, stepId: step.id },
      {
        id: runId,
        sessionId,
        mode,
        step: step.id,
        phase,
        prompt,
        status: 'running',
        pid: process.pid,
        startedAt,
        endedAt: null,
        durationMs: 0,
        usage: null,
        result: null,
        error: null,
      },
      writeDir,
    )
    const sendPrompt = sessionStore.readStepRunPrompt(
      sessionId,
      { phase, stepId: step.id },
      writeDir,
    )

    const failStep = (err, exitCode = 2, extraPatch = {}, failExtra = {}) => {
      const message = errorMessage(err)
      sessionStore.writeStepRun(
        sessionId,
        { phase, stepId: step.id },
        { ...record, ...extraPatch, status: failureStatus(err), error: message, endedAt: Date.now() },
        writeDir,
      )
      fail(err, { runId, phase, step: step.id, prefix: `step ${step.id} phase ${phase} failed`, ...failExtra }, exitCode)
      return { stopped: true }
    }

    if (sendPrompt == null) {
      return failStep(`prompt file missing for step ${step.id}`, 1)
    }
    if (step.promptKey === 'executePhase' && !vars.planBody.trim()) {
      return failStep(`phase ${phase} plan.md is empty; re-run the plan step before executing`, 1)
    }

    try {
      const cwd = workspaceStore.resolveSessionCwd(session, writeDir)
      const snap = snapshotIfGitRepo(cwd, {
        message: `harness: snapshot before decompose ${step.id} phase ${phase} ${runId}`,
      })
      if (snap.committed) logLine(`git snapshot ${snap.hash} in ${cwd}`)
    } catch (err) {
      return failStep(err, 1)
    }

    let capturedPlan = null
    const onEvent = (event) => {
      const plan = planFromToolCall(event)
      if (plan != null) capturedPlan = plan
      eventLog.append(sessionId, { ...event, runId, phase, step: step.id }, writeDir)
    }

    logLine(`step ${step.id} phase ${phase} model=${model || 'default'} mode=${mode}`)
    eventLog.append(
      sessionId,
      {
        type: 'status',
        status: phase ? `phase ${phase} ${step.id}` : step.id,
        runId,
        phase,
        step: step.id,
      },
      writeDir,
    )

    let result
    try {
      const live = sessionStore.loadSession(sessionId, writeDir) || session
      const turn = await runOneTurn({
        session: { ...live, providerAgentId: null, providerUsage: null },
        fresh: true,
        runId,
        writeDir,
        action: 'run',
        mode,
        prompt: sendPrompt,
        model,
        tools: step.tools,
        outputSchema: step.outputSchema,
        signal: abortController.signal,
        onEvent,
        askUser,
        harnessTools: registry.toolsFor(registry.sessionWorkspace(live), { mode: 'decompose', provider: live.provider }),
        onInflight: (next) => {
          inflight = next
          if (next) {
            record.providerRunId = next.providerRunId || next.runId
            sessionStore.writeStepRun(sessionId, { phase, stepId: step.id }, record, writeDir)
          }
        },
        onCreated: (providerAgentId) => {
          record.providerAgentId = providerAgentId
          if (live.provider === 'cursor') record.transcriptFile = paths.runTranscriptFile(sessionId, runId, writeDir)
          sessionStore.writeStepRun(sessionId, { phase, stepId: step.id }, record, writeDir)
          sessionStore.updateSession(
            sessionId,
            { providerAgentId: providerAgentId || live.providerAgentId, providerUsage: null, status: 'running' },
            writeDir,
          )
        },
      })
      result = turn.result
      record.transcriptStatus = result.transcriptStatus
      record.transcriptError = result.transcriptError
      if (result.providerUsage) sessionStore.updateSession(sessionId, { providerUsage: result.providerUsage }, writeDir)
    } catch (err) {
      return failStep(err, 2)
    }

    const durationMs = result.durationMs || Date.now() - startedAt
    sessionStore.addToTotals(sessionId, { runId, usage: result.usage, durationMs }, writeDir)
    analytics.notifySession(sessionId)

    const patch = {
      ...record,
      endedAt: Date.now(),
      durationMs,
      usage: result.usage,
      result: result.result,
      error: result.error,
    }

    if (terminating || result.status === 'cancelled') {
      const intent = readControlIntent(sessionId, writeDir) || 'paused'
      logLine(`terminated (${intent}) during ${step.id} phase ${phase}`)
      sessionStore.writeStepRun(
        sessionId,
        { phase, stepId: step.id },
        { ...patch, status: 'cancelled' },
        writeDir,
      )
      finalize(intent === 'stop' ? 'stopped' : 'paused', 0)
      return { stopped: true }
    }

    if (result.status === 'error') {
      return failStep(result.error || 'run failed', 2, patch)
    }

    const artifact = capturedPlan || result.result
    if (step.write && !step.write.endsWith('.json') && artifact) {
      sessionStore.writeStepArtifact(
        sessionId,
        { phase, filename: step.write },
        String(artifact),
        writeDir,
      )
    }

    let parsed = null
    if (step.parse) {
      try {
        parsed = parseStepOutput(step, result.result)
      } catch (err) {
        return failStep(err, 2, patch)
      }
      if (step.parse === 'phaseCount') {
        sessionStore.writePhases(sessionId, parsed, writeDir)
      }
    }

    sessionStore.writeStepRun(
      sessionId,
      { phase, stepId: step.id },
      { ...patch, status: 'completed' },
      writeDir,
    )

    const total = (parsed && parsed.count) || totalPhases || 0
    const next = nextProgress(phase, step.id, total)
    sessionStore.updateSession(
      sessionId,
      { currentPhase: next.currentPhase, currentStep: next.currentStep, totalPhases: total || null },
      writeDir,
    )
    logLine(`step finished: ${step.id} phase ${phase} -> ${next.currentStep}`)
    return { stopped: false, parsed, next }
  }

  try {
    sessionStore.updateSession(
      sessionId,
      { mode: 'decompose', status: 'running', lastError: null },
      writeDir,
    )
    logLine(resume ? 'resuming decompose pipeline' : 'starting decompose pipeline')

    const liveProgress = progress()
    if (resume && liveProgress.currentStep === 'done') {
      logLine('decompose already complete')
      finalize('finished', 0)
      return
    }

    let phasesDoc = sessionStore.readPhases(sessionId, writeDir)
    const once = onceSteps()
    for (const step of once) {
      if (shouldSkip(resume, liveProgress.currentPhase, liveProgress.currentStep, 0, step.id, once)) {
        logLine(`skip once step ${step.id}`)
        continue
      }
      const outcome = await runStep({
        step,
        phase: 0,
        totalPhases: liveProgress.totalPhases,
        sourcePlan,
      })
      if (outcome.stopped) return
      if (outcome.parsed && outcome.parsed.count) phasesDoc = outcome.parsed
      if (terminating) {
        const intent = readControlIntent(sessionId, writeDir) || 'paused'
        finalize(intent === 'stop' ? 'stopped' : 'paused', 0)
        return
      }
    }

    if (!phasesDoc) phasesDoc = sessionStore.readPhases(sessionId, writeDir)
    const totalPhases = phasesDoc && phasesDoc.count
    if (!totalPhases) {
      fail('no phase count after count step', { phase: 0, step: 'count', prefix: 'decompose' })
      return
    }

    sessionStore.updateSession(sessionId, { totalPhases }, writeDir)
    const each = eachPhaseSteps()
    const afterOnce = progress()

    for (let n = 1; n <= totalPhases; n += 1) {
      for (const step of each) {
        if (shouldSkip(resume, afterOnce.currentPhase, afterOnce.currentStep, n, step.id, each)) {
          logLine(`skip phase ${n} ${step.id}`)
          continue
        }
        const outcome = await runStep({
          step,
          phase: n,
          totalPhases,
          sourcePlan,
        })
        if (outcome.stopped) return
        if (terminating) {
          const intent = readControlIntent(sessionId, writeDir) || 'paused'
          finalize(intent === 'stop' ? 'stopped' : 'paused', 0)
          return
        }
      }
    }

    sessionStore.updateSession(
      sessionId,
      { currentPhase: totalPhases, currentStep: 'done', totalPhases, status: 'finished', lastError: null },
      writeDir,
    )
    logLine('decompose pipeline finished')
    finalize('finished', 0)
  } catch (err) {
    if (!exiting) fail(err, { prefix: 'decompose' })
  }
}

module.exports = { runDecomposeDaemon }
