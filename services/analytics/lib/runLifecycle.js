const config = require('./config')
const sync = require('./sync')
const { natsConfig } = require('../../harness/src/harness/natsConfig')
const { createRunLifecycleConsumer } = require('../../harness/src/harness/runLifecycleConsumer')

const createLifecycle = ({ queue }) => {
  const transport = natsConfig({ writeDir: config.harnessWriteDir, dbPath: config.harnessDbPath })
  const consumer = createRunLifecycleConsumer({
    transport, name: 'analytics-run-lifecycle',
    onEvent: async event => {
      const id = await sync.syncSession(event.sessionId)
      if (!id) return
      const pairs = await sync.stalePairs({ sessionIds: [id] })
      if (pairs.length) await queue.enqueue({
        kind: 'run-lifecycle',
        params: { sessionId: id, runId: event.runId, eventId: event.eventId, type: event.type },
        pairs,
      })
    },
    // Subscribe first, then reconcile: this also catches runs completed during
    // a core NATS disconnect or while analytics was offline.
    onReconnect: async () => {
      const ids = await sync.syncAll()
      const pairs = await sync.stalePairs({ sessionIds: ids })
      if (pairs.length) await queue.enqueue({ kind: 'lifecycle-recovery', params: {}, pairs })
      console.log(`analytics: reconciled ${ids.length} sessions after NATS connection`)
    },
  })
  return { start: consumer.start, stop: consumer.stop }
}

module.exports = { createLifecycle }
