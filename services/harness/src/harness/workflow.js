const config = require('../config')
const store = require('../store/sessionStore')
const registry = require('../registry')
const eventLog = require('../store/eventLog')
const { sessionModel } = require('../prompt/context')

// Workflow steps are ordinary sessions. The controller owns their prompts and
// sequencing; their daemons own the same turn lifecycle as ask, plan and execute.
const runWorkflowTurn = async ({ parent, parentRunId, mode, prompt, promptProvenance, name, workflow, outputSchema, signal, onPrepared }) => {
  const writeDir = config.writeDir
  const delegation = require('./delegation')
  const Harness = require('./Harness')
  if (signal?.aborted) return { status: 'cancelled' }
  registry.requireMode(registry.sessionWorkspace(parent), mode, { provider: parent.provider })
  const created = store.createSession({
    workspaceId: parent.workspaceId,
    provider: parent.provider,
    model: sessionModel(parent),
    codex: parent.codex,
    grok: parent.grok,
    claude: parent.claude,
  }, writeDir)
  const session = store.updateSession(created.id, {
    mode, name, workflow, childKind: 'workflow',
    parentSessionId: parent.id, parentRunId,
    rootSessionId: parent.rootSessionId || parent.id,
    archived: Boolean(store.loadSession(parent.id, writeDir)?.archived),
  }, writeDir)
  const controller = store.loadRun(parent.id, parentRunId, writeDir)
  store.updateRun(parent.id, parentRunId, { workflowChildren: [...(controller.workflowChildren || []), session.id] }, writeDir)
  let launched
  try {
    launched = Harness.spawnRun(session.id, mode === 'plan' ? 'plan' : 'run', {
      mode, prompt,
      promptProvenance: promptProvenance || { sections: [{ kind: 'context', label: 'Workflow prompt', text: prompt }] },
      onPrepared: (run) => {
        if (outputSchema) store.updateRun(session.id, run.id, { outputSchema }, writeDir)
        onPrepared?.(session, run)
      },
    })
  } catch (err) {
    store.updateSession(session.id, { status: 'error', lastError: { message: err.message, at: Date.now() } }, writeDir)
    throw err
  }
  eventLog.append(parent.id, { type: 'workflow_child', runId: parentRunId,
    childSessionId: session.id, childRunId: launched.id, mode, name, workflow }, writeDir)

  return new Promise((resolve, reject) => {
    let checking = false
    let finished = false
    let stoppedAt = null
    const finish = (err, result) => {
      if (finished) return
      finished = true
      clearInterval(timer)
      signal?.removeEventListener('abort', cancel)
      if (err) reject(err)
      else resolve(result)
    }
    const cancel = () => {
      try {
        stoppedAt ||= Date.now()
        Harness.stop(session.id)
      } catch (err) { finish(err) }
    }
    const check = async () => {
      if (checking || finished) return
      checking = true
      try {
        const state = await Harness.status(session.id)
        if (!state) throw new Error(`workflow session disappeared: ${session.id}`)
        // A stopped worker must not hold the controller open indefinitely.
        if (stoppedAt && Date.now() - stoppedAt > 10000 && state.daemonPid) {
          require('./process').signal(-state.daemonPid, 'SIGKILL')
        }
        const last = state.runs.at(-1)
        if (state.daemonAlive || !last?.endedAt) return
        if (!signal?.aborted && delegation.hasPendingChildren(session.id)) return
        finish(null, {
          ...last,
          status: signal?.aborted ? 'cancelled' : last.status,
          childSessionId: session.id,
          childRunId: last.id,
          // Usage stays on the child runs; the controller holds references only.
          usage: null,
        })
      } catch (err) { finish(err) }
      finally { checking = false }
    }
    const timer = setInterval(check, 500)
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()
    check()
  })
}

module.exports = { runWorkflowTurn }
