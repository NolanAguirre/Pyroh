const { connect, JSONCodec } = require('nats')

const TYPES = new Set(['started', 'completed', 'failed', 'cancelled'])

// Core NATS is live delivery. Disk reconciliation covers subscription gaps.
const createRunLifecycleConsumer = ({ transport, name, onEvent, onReconnect = async () => {} }) => {
  const codec = JSONCodec()
  const pending = new Map()
  const seen = new Set()
  let connection = null
  let stopped = false
  let connecting = false
  let processing = false
  let reconcile = true
  let timer = null
  const report = (error) => process.stderr.write(`${name}: ${error.message || error}\n`)

  const processPending = async () => {
    if (processing || stopped) return
    processing = true
    try {
      if (reconcile) {
        reconcile = false
        try { await onReconnect() }
        catch (error) {
          reconcile = true
          report(error)
        }
      }
      for (const [id, event] of pending) {
        if (stopped) break
        try {
          await onEvent(event)
          pending.delete(id)
          seen.add(id)
          if (seen.size > 10000) seen.delete(seen.values().next().value)
        } catch (error) { report(error) }
      }
    } finally { processing = false }
  }

  const receive = (error, message) => {
    if (error) return report(error)
    try {
      const event = codec.decode(message.data)
      if (event.version !== 1 || !TYPES.has(event.type) || typeof event.eventId !== 'string' ||
        typeof event.runId !== 'string' || typeof event.sessionId !== 'string' ||
        event.storageKey !== transport.storageKey) throw new Error('Invalid run lifecycle event')
      if (!seen.has(event.eventId)) pending.set(event.eventId, event)
      processPending().catch(report)
    } catch (cause) { report(cause) }
  }

  const connectOnce = async () => {
    if (stopped || connecting || connection) return
    connecting = true
    try {
      const active = await connect({ servers: transport.servers, name, timeout: 2000,
        maxReconnectAttempts: -1, reconnectTimeWait: 1000 })
      if (stopped) {
        await active.close()
        return
      }
      connection = active
      active.subscribe(transport.lifecycleSubject, { callback: receive })
      const monitor = async () => {
        for await (const status of active.status()) {
          if (status.type === 'error') report(new Error(String(status.data)))
          if (status.type === 'reconnect') {
            reconcile = true
            processPending().catch(report)
          }
        }
      }
      monitor().catch(report)
      active.closed().then(error => {
        if (connection === active) connection = null
        if (error && !stopped) report(error)
      }).catch(report)
      await active.flush()
      reconcile = true
      await processPending()
    } catch (error) {
      report(error)
      await connection?.close()
      connection = null
    } finally { connecting = false }
  }

  const start = () => {
    if (timer || stopped) return
    timer = setInterval(() => {
      connectOnce().catch(report)
      processPending().catch(report)
    }, 1000)
    connectOnce().catch(report)
  }
  const stop = async () => {
    stopped = true
    clearInterval(timer)
    await connection?.close()
  }
  return { start, stop }
}

module.exports = { createRunLifecycleConsumer }
