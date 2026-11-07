const config = require('../../config')
const paths = require('../../store/paths')
const { writeJson, ensureDir } = require('../../store/jsonFile')
const sessionStore = require('../../store/sessionStore')
const { sessionContext } = require('../../prompt/context')
const eventLog = require('../../store/eventLog')
const { errorMessage, formatError } = require('../../store/formatError')
const { failureStatus } = require('../../store/networkError')
const { runWorkflowTurn } = require('../../harness/workflow')
const { attachLog, readControlIntent, clearControl, removePid } = require('../../harness/daemon')
const analytics = require('../../analytics/client')
const {
  onceSteps,
  eachPhaseSteps,
  promptForWithProvenance,
  parseStepOutput,
  nextProgress,
  shouldSkip,
} = require('./pipeline')

const runDecomposeDaemon = async ({ sessionId, resume = false }) => {
  const writeDir = config.writeDir
  require('../../store/sessionLock').acquire(sessionId, writeDir)
  const log = attachLog(sessionId, writeDir)
  const logLine = (msg) => process.stdout.write(`[${new Date().toISOString()}] ${msg}\n`)

  ensureDir(paths.sessionDir(sessionId, writeDir))
  const workflowRun = sessionStore.createRun(sessionId, { mode: 'decompose', prompt: sessionStore.readSourcePlan(sessionId, writeDir) || '',
    promptProvenance: sessionStore.loadSession(sessionId, writeDir)?.sourcePlanProvenance }, writeDir)
  sessionStore.updateRun(sessionId, workflowRun.id, { pid: process.pid, workflow: true }, writeDir)
  writeJson(paths.daemonPid(sessionId, writeDir), {
    pid: process.pid,
    identity: require('../../store/sessionLock').identity(),
    kind: 'decompose',
    runId: workflowRun.id,
    startedAt: Date.now(),
  })

  const session = sessionStore.loadSession(sessionId, writeDir)
  const sourcePlan = sessionStore.readSourcePlan(sessionId, writeDir)

  const abortController = new AbortController()
  let terminating = false
  let exiting = false
  let activeRunId = null
  let activePhase = 0
  let activeStepId = null

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
      sessionStore.updateRun(sessionId, workflowRun.id, {
        status: sessionStatus === 'finished' ? 'completed' : ['paused', 'stopped'].includes(sessionStatus) ? 'cancelled' : sessionStatus,
        endedAt: Date.now(), error: extra.lastError?.message || null,
      }, writeDir)
      if (sessionStatus !== 'finished') require('../../harness/delegation').stopChildren(sessionId, workflowRun.id)
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
            stack: err?.stack,
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
    require('../../harness/delegation').stopChildren(sessionId, workflowRun.id)
  }
  process.on('SIGTERM', onSignal)
  process.on('SIGINT', onSignal)
  if (readControlIntent(sessionId, writeDir)) await onSignal()

  const progress = () => {
    const live = sessionStore.loadSession(sessionId, writeDir) || session
    return {
      currentPhase: live.currentPhase == null ? null : live.currentPhase,
      currentStep: live.currentStep == null ? null : live.currentStep,
      totalPhases: live.totalPhases == null ? null : live.totalPhases,
    }
  }

  const runStep = async ({ step, phase, totalPhases, sourcePlan: planText }) => {
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
    const mode = step.agentMode || 'agent'
    const parent = sessionStore.loadSession(sessionId, writeDir) || session
    const assembled = promptForWithProvenance(step, vars, parent.provider, sessionContext(parent, mode), parent.sourcePlanProvenance)
    const prompt = assembled.text

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

    logLine(`step ${step.id} phase ${phase} mode=${mode}`)
    eventLog.append(sessionId, {
      type: 'status', status: phase ? `phase ${phase} ${step.id}` : step.id,
      runId, phase, step: step.id,
    }, writeDir)

    let result
    try {
      result = await runWorkflowTurn({
        parent,
        parentRunId: workflowRun.id,
        mode,
        prompt: sendPrompt,
        promptProvenance: assembled,
        name: phase ? `Phase ${phase}: ${step.id === 'execute' ? 'Execute' : 'Plan'}` : 'Count phases',
        workflow: { kind: 'decompose', phase, step: step.id },
        outputSchema: step.outputSchema,
        signal: abortController.signal,
        onPrepared: (child, run) => {
          record.childSessionId = child.id
          record.childRunId = run.id
          sessionStore.writeStepRun(sessionId, { phase, stepId: step.id }, record, writeDir)
        },
      })
      record.childRunId = result.childRunId || record.childRunId
      record.transcriptStatus = result.transcriptStatus
      record.transcriptError = result.transcriptError
    } catch (err) {
      return failStep(err, 2)
    }

    const durationMs = 0

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

    if (!['completed', 'finished'].includes(result.status)) {
      return failStep(result.error || 'run failed', 2, patch)
    }

    const artifact = result.plan || result.result
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
