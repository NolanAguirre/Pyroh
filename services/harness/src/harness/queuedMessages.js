const fs = require('fs')
const config = require('../config')
const paths = require('../store/paths')
const store = require('../store/sessionStore')
const queue = require('../store/queuedMessageStore')
const steerStore = require('../store/steerStore')
const locks = require('../store/sessionLock')
const registry = require('../registry')

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const withDeliveryLock = (sessionId, fn) => require('./delegation').withDeliveryLock(sessionId, fn)
const loadSession = (sessionId) => {
  const session = store.loadSession(sessionId, config.writeDir)
  if (!session) fail('session not found', 404)
  return session
}

const resolve = (session, requested) => {
  const Harness = require('./Harness')
  if (session.childKind === 'workflow') fail('workflow sessions cannot queue follow-up messages', 409)
  if (session.status === 'queued') fail('session is waiting for its first prompt', 409)
  const runs = store.listRuns(session.id, config.writeDir)
  if (!runs.length) fail('send the first message before queueing a follow-up', 409)
  const workspace = registry.sessionWorkspace(session)
  if (registry.findMode(workspace, session.mode)?.steerable === false) fail('this workflow does not support queued follow-ups', 409)
  const latest = runs.at(-1)
  const active = registry.findMode(workspace, latest.mode)
  if (['running', 'awaiting_input'].includes(session.status) &&
      (active?.pipeline || active?.onComplete)) fail('this workflow does not support queued follow-ups', 409)
  const mode = requested || Harness.replyMode(session)
  if (typeof mode !== 'string') fail('mode must be a string')
  const harness = workspace ? registry.makeHarnessApi(workspace, session) : undefined
  const entry = registry.requireMode(workspace, mode, { harness, provider: session.provider })
  const inPlace = Harness.repliesInPlace(session, entry)
  if (!inPlace && (entry.newSession || entry.launch || entry.pipeline || !['turn', 'plugin'].includes(entry.kind))) {
    fail(`mode ${mode} cannot be queued as a follow-up`)
  }
  if (entry.kind === 'plugin' && !harness) fail('plugin modes need a workspace')
  return { mode, entry, inPlace, harness }
}

const enqueue = (sessionId, { prompt = '', mode, promptProvenance, images } = {}) => {
  images = require('../store/imageStore').normalizeImages(sessionId, images, config.writeDir)
  if (typeof prompt !== 'string' || (!prompt.trim() && !images.length)) fail('prompt or images are required')
  loadSession(sessionId)
  return withDeliveryLock(sessionId, () => {
    const selected = resolve(loadSession(sessionId), mode)
    return queue.enqueue(sessionId, prompt, selected.mode, config.writeDir, promptProvenance, images)
  })
}

const cancel = (sessionId, messageId) => {
  loadSession(sessionId)
  return withDeliveryLock(sessionId, () => {
    const state = queue.read(sessionId)
    const message = state.messages.find(item => item.id === messageId)
    if (!message) fail('queued message not found', 404)
    const receipt = store.listRuns(sessionId, config.writeDir).find(run => run.queuedMessage?.messageId === messageId)
    if (message.runId || receipt || steerStore.queuedReceipt(sessionId, messageId, config.writeDir)) fail('message has already been dispatched', 409)
    state.messages = state.messages.filter(item => item.id !== messageId)
    queue.save(sessionId, state)
  })
}

// Never hold a process-local reentrant session lock across plugin awaits.
// Recheck the head under both locks after preparation, including cancellation.
const prepare = async (session, message) => {
  const { entry, inPlace, harness } = resolve(session, message.mode)
  let prompt = message.text
  let promptProvenance = message.promptProvenance
  let plugin
  if (entry.kind === 'plugin') {
    if (inPlace) {
      plugin = store.listRuns(session.id, config.writeDir).findLast(run => run.mode === entry.id && run.plugin)?.plugin
    } else {
      const prepared = await require('./Harness').preparePluginTurn(session, entry, harness, {
        mode: message.mode, prompt, promptProvenance, images: message.images,
      })
      prompt = prepared.prompt
      promptProvenance = prepared.promptProvenance
      plugin = prepared.plugin
    }
  }
  return { mode: message.mode, prompt, plugin, images: message.images,
    promptProvenance: require('../prompt/provenance').supplied(prompt, promptProvenance) }
}

const withIdle = (sessionId, fn) => withDeliveryLock(sessionId, () => {
  if (locks.holds(sessionId, config.writeDir)) return null
  let lock
  try { lock = locks.acquire(sessionId, config.writeDir) }
  catch (err) { if (err.status === 409) return null; throw err }
  try {
    store.recoverSession(sessionId, config.writeDir)
    return fn(loadSession(sessionId), lock)
  } finally { lock.release() }
})

// A receipt is committed with the run, before spawning. Reconcile the queue
// from that receipt after a crash, and only retry the same unstarted run ID.
const reconcile = (sessionId, state) => {
  const runs = store.listRuns(sessionId, config.writeDir)
  let changed = false
  state.messages = state.messages.filter(message => {
    if (steerStore.queuedReceipt(sessionId, message.id, config.writeDir)) {
      changed = true
      return false
    }
    const run = runs.find(item => item.queuedMessage?.messageId === message.id)
    if (!run) return true
    if (run.queuedMessage.attemptStartedAt || run.pid || run.providerRunId || run.providerAgentId ||
        ['completed', 'cancelled'].includes(run.status)) {
      changed = true
      return false
    }
    if (message.runId !== run.id) { message.runId = run.id; changed = true }
    return true
  })
  if (changed) queue.save(sessionId, state)
  return state
}

const send = async (sessionId, messageId) => {
  loadSession(sessionId)
  const pending = () => {
    const state = queue.read(sessionId)
    const message = state.messages.find(item => item.id === messageId)
    if (!message) fail('queued message not found', 404)
    const receipt = store.listRuns(sessionId, config.writeDir).find(run => run.queuedMessage?.messageId === messageId)
    if (message.runId || receipt || steerStore.queuedReceipt(sessionId, messageId, config.writeDir)) {
      fail('message has already been dispatched', 409)
    }
    return { state, message }
  }
  const next = withDeliveryLock(sessionId, () => ({ session: loadSession(sessionId), ...pending() }))
  const prepared = await prepare(next.session, next.message)
  return withDeliveryLock(sessionId, () => {
    // Preparation may await a plugin. The pump, Cancel, or another Send now
    // request may have claimed this row in the meantime.
    const { state, message } = pending()
    const started = withIdle(sessionId, session => {
      resolve(session, message.mode)
      const run = require('./Harness').spawnRun(sessionId, prepared.mode === 'plan' ? 'plan' : 'run', {
        ...prepared,
        queuedMessage: { messageId },
        onPrepared: run => {
          message.runId = run.id
          message.retryAt = Date.now() + 30000
          queue.save(sessionId, state)
        },
      })
      return { run }
    })
    if (started) return started
    resolve(loadSession(sessionId), message.mode)
    const steer = require('./Harness').steer(sessionId, prepared.prompt, { queuedMessageId: messageId, promptProvenance: prepared.promptProvenance, images: prepared.images })
    state.messages = state.messages.filter(item => item.id !== messageId)
    queue.save(sessionId, state)
    return { steer }
  })
}

const dispatchOne = async (sessionId) => {
  const next = withIdle(sessionId, (session, lock) => {
    const state = reconcile(sessionId, queue.read(sessionId))
    const message = state.messages[0]
    if (!message) {
      // Finish a clear interrupted between its record write and marker removal.
      queue.save(sessionId, state)
      return null
    }
    if (message.retryAt > Date.now() || session.childKind === 'workflow' || session.status === 'queued') return null
    if (message.runId) {
      resolve(session, message.mode)
      const run = store.loadRun(sessionId, message.runId, config.writeDir)
      message.retryAt = Date.now() + 30000
      queue.save(sessionId, state)
      fs.rmSync(paths.controlFile(sessionId, config.writeDir), { force: true })
      store.updateRun(sessionId, run.id, { status: 'running', endedAt: null, error: null }, config.writeDir)
      store.updateSession(sessionId, { status: 'running' }, config.writeDir)
      require('./process').spawnHarness([run.mode === 'plan' ? 'plan' : 'run', sessionId, '--run-id', run.id], lock.spawnOptions())
      return null
    }
    return { session, message }
  })
  if (!next) return
  try {
    const prepared = await prepare(next.session, next.message)
    withIdle(sessionId, (session) => {
      const state = reconcile(sessionId, queue.read(sessionId))
      const head = state.messages[0]
      if (head?.id !== next.message.id || head.runId) return
      resolve(session, head.mode)
      head.retryAt = Date.now() + 30000
      queue.save(sessionId, state)
      require('./Harness').spawnRun(sessionId, prepared.mode === 'plan' ? 'plan' : 'run', {
        ...prepared,
        queuedMessage: { messageId: head.id },
        onPrepared: run => {
          head.runId = run.id
          queue.save(sessionId, state)
        },
      })
    })
  } catch (err) {
    withDeliveryLock(sessionId, () => {
      const state = queue.read(sessionId)
      const message = state.messages.find(item => item.id === next.message.id)
      if (!message) return
      if (message.error !== err.message) require('../store/eventLog').append(sessionId, {
        type: 'error', message: `Queued message could not start: ${err.message}`,
      }, config.writeDir)
      message.error = err.message
      message.retryAt = Date.now() + 30000
      queue.save(sessionId, state)
    })
    throw err
  }
}

let pumping = false
const pump = async () => {
  if (pumping) return
  pumping = true
  try {
    for (const sessionId of await queue.sessions()) {
      try { await dispatchOne(sessionId) }
      catch (err) { if (err.status !== 409) process.stderr.write(`queued messages ${sessionId}: ${err.message}\n`) }
      await new Promise(resolve => setImmediate(resolve))
    }
  } finally { pumping = false }
}

module.exports = { enqueue, cancel, send, dispatchOne, pump }
