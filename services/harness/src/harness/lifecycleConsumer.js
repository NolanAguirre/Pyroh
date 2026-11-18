const { connect, JSONCodec } = require('nats')

// Core NATS carries invalidations. Reconcile disk after SUB is acknowledged,
// including after reconnect, to cover events sent during subscription gaps.
const createLifecycleConsumer = ({ transport, subject, name, valid, onEvent, onReconnect = async () => {} }) => {
  const codec = JSONCodec()
  const pending = new Map()
  const seen = new Set()
  let connection = null
  let subscription = null
  let opening = null
  let stopped = false
  let ready = false
  let processing = false
  let reconcile = true
  let timer = null
  const report = error => {
    if (!stopped) process.stderr.write(`${name}: ${error.message || error}\n`)
  }

  const processPending = async () => {
    if (processing || stopped || !ready) return
    processing = true
    try {
      while (!stopped && ready && (reconcile || pending.size)) {
        if (reconcile) {
          reconcile = false
          try { await onReconnect() }
          catch (error) {
            reconcile = true
            report(error)
            return
          }
        }
        for (const [id, event] of pending) {
          if (stopped || !ready) break
          try {
            await onEvent(event)
            pending.delete(id)
            seen.add(id)
            if (seen.size > 10000) seen.delete(seen.values().next().value)
          } catch (error) {
            report(error)
            return
          }
        }
      }
    } finally { processing = false }
  }

  const receive = (error, message) => {
    if (stopped) return
    if (error) {
      report(error)
      connection?.close().catch(report)
      return
    }
    try {
      const event = codec.decode(message.data)
      if (event?.version !== 1 || typeof event.eventId !== 'string' ||
        typeof event.sessionId !== 'string' || event.storageKey !== transport.storageKey || !valid(event)) {
        throw new Error('Invalid lifecycle event')
      }
      if (!seen.has(event.eventId)) pending.set(event.eventId, event)
      processPending().catch(report)
    } catch (cause) { report(cause) }
  }

  const connectOnce = async () => {
    let active
    try {
      active = await connect({ servers: transport.servers, name, timeout: 2000,
        maxReconnectAttempts: -1, reconnectTimeWait: 1000 })
      if (stopped) {
        await active.close()
        return
      }
      connection = active
      subscription = active.subscribe(subject, { callback: receive })
      const synchronized = async () => {
        let barrierTimer
        try {
          await Promise.race([
            active.flush(),
            new Promise((resolve, reject) => {
              barrierTimer = setTimeout(() => reject(new Error('NATS lifecycle subscription timed out')), Math.min(transport.timeout, 5000))
            }),
          ])
        } finally { clearTimeout(barrierTimer) }
        if (stopped || connection !== active || active.isClosed()) return
        ready = true
        reconcile = true
        await processPending()
      }
      const monitor = async () => {
        for await (const status of active.status()) {
          if (status.type === 'error') report(new Error(String(status.data)))
          if (status.type === 'disconnect') ready = false
          if (status.type === 'reconnect') await synchronized()
        }
      }
      monitor().catch(error => {
        report(error)
        active.close().catch(report)
      })
      active.closed().then(error => {
        if (connection === active) {
          connection = null
          subscription = null
          ready = false
        }
        if (error) report(error)
      }).catch(report)
      await synchronized()
    } catch (error) {
      report(error)
      await active?.close()
      if (connection === active) {
        connection = null
        subscription = null
        ready = false
      }
    }
  }

  const tick = () => {
    if (stopped) return
    if (!connection && !opening) opening = connectOnce().catch(report).finally(() => { opening = null })
    processPending().catch(report)
  }
  const start = () => {
    if (timer || stopped) return
    // Retry transport/callback failures only, never poll question records.
    timer = setInterval(tick, 1000)
    tick()
  }
  const stop = async () => {
    stopped = true
    ready = false
    clearInterval(timer)
    subscription?.unsubscribe()
    pending.clear()
    seen.clear()
    await connection?.close()
    await opening
  }
  return { start, stop }
}

module.exports = { createLifecycleConsumer }
