const path = require('path')
const { fork } = require('child_process')
const config = require('../config')
const { createRunLifecycleConsumer } = require('../harness/runLifecycleConsumer')
const transport = require('../harness/spawnConfig')

// Internal worker, not another service: it shares configuration and dies when
// the API's IPC channel closes. Agent daemons retain their existing lifecycle.
const startMaintenance = ({ onReconciled = () => {} } = {}) => {
  let child = null
  let retry = null
  let stopped = false
  const launch = () => {
    if (stopped) return
    const worker = fork(path.join(__dirname, 'maintenance.js'), [], {
      env: { ...process.env, HARNESS_MAINTENANCE_WORKER: '1' },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    })
    child = worker
    worker.on('message', message => {
      if (message?.type === 'reconciled') onReconciled()
    })
    const restart = () => {
      if (child !== worker) return
      child = null
      if (!stopped) retry = setTimeout(launch, 1000)
    }
    worker.once('error', err => {
      process.stderr.write(`maintenance worker: ${err.message}\n`)
      restart()
    })
    worker.once('exit', (code, signal) => {
      if (!stopped) process.stderr.write(`maintenance worker exited (${signal || code}); restarting\n`)
      restart()
    })
  }
  launch()
  return () => {
    stopped = true
    clearTimeout(retry)
    if (child?.connected) child.disconnect()
    child?.kill('SIGTERM')
    child = null
  }
}

const runMaintenance = () => {
  let markReconciled
  const initiallyReconciled = new Promise(resolve => { markReconciled = resolve })
  // Each job owns a process-local guard; durable claims remain scoped to the
  // particular session or delivery being changed.
  const schedule = (name, interval, task) => {
    let running = false
    const run = async () => {
      if (running) return
      running = true
      const started = Date.now()
      try { await task() }
      catch (err) { process.stderr.write(`${name}: ${err.message}\n`) }
      finally {
        running = false
        const elapsed = Date.now() - started
        if (elapsed > 1000) process.stderr.write(`${name}: ${elapsed}ms\n`)
      }
    }
    run()
    setInterval(run, interval)
  }
  const lifecycle = createRunLifecycleConsumer({
    transport, name: 'harness-parent-lifecycle',
    onEvent: async event => {
      if (event.type === 'started' || event.scope === 'step') return
      await initiallyReconciled
      await require('../harness/delegation').recover({
        sessionIds: [...new Set([event.sessionId, event.parentSessionId].filter(Boolean))],
      })
    },
    onReconnect: async () => {
      await initiallyReconciled
      await require('../harness/delegation').recover()
    },
  })
  lifecycle.start()
  process.once('disconnect', () => { lifecycle.stop().finally(() => process.exit(0)) })
  schedule('run lifecycle publish', 1000, () => require('../store/runLifecycle').flush(config.writeDir))
  schedule('question lifecycle publish', 1000, () => require('../store/questionLifecycle').flush(config.writeDir))
  schedule('session index reconcile', 60000, async () => {
    await require('../store/sessionIndex').reconcile(config.writeDir)
    markReconciled()
    if (process.connected) process.send({ type: 'reconciled' })
  })
  schedule('child recovery', 5000, async () => {
    await initiallyReconciled
    await require('../harness/delegation').recover()
  })
  schedule('run after', 1000, () => require('../harness/runAfter').pump())
  schedule('queued messages', 1000, () => require('../harness/queuedMessages').pump())
  schedule('Cursor usage recovery', 60000, async () => {
    await initiallyReconciled
    await require('../store/cursorUsageRecovery').recoverAll()
  })
}

if (require.main === module) runMaintenance()

module.exports = { startMaintenance }
