const { connect, JSONCodec } = require('nats')
const { servers, subject } = require('../harness/src/harness/spawnConfig')
const { createSpawnDispatcher } = require('../harness/src/harness/spawnDispatch')
const { VERSION, serializeError } = require('../harness/src/harness/spawnProtocol')

const createWorker = () => {
  const codec = JSONCodec()
  const dispatcher = createSpawnDispatcher()
  let connection
  let subscription
  let stopping = false
  let retryTimer
  let resumeRetry
  let shutdown

  const report = (error) => process.stderr.write(`agent-spawn: ${error.message || error}\n`)

  const stop = () => {
    if (shutdown) return shutdown
    stopping = true
    clearTimeout(retryTimer)
    resumeRetry?.()
    shutdown = (async () => {
      const active = connection
      if (!active) return
      subscription?.unsubscribe()
      try { await active.drain() }
      catch (error) { report(error) }
      finally { await active.close() }
    })()
    return shutdown
  }

  const receive = (error, message) => {
    if (error) return report(error)
    if (!message.reply) return
    let request
    let reply
    try {
      request = codec.decode(message.data)
      if (stopping) throw Object.assign(new Error('Agent spawn worker is shutting down'), { status: 503 })
      // Dispatch is synchronous while it owns the session lease. Requests from
      // different callers never share process-local locks across an await.
      reply = dispatcher.dispatch(request)
    } catch (cause) {
      reply = { version: VERSION, requestId: request?.requestId, sessionId: request?.sessionId, ok: false, error: serializeError(cause) }
    }
    try { message.respond(codec.encode(reply)) }
    catch (cause) { report(cause) }
  }

  const start = async () => {
    process.once('SIGTERM', stop)
    process.once('SIGINT', stop)
    try {
      while (!stopping) {
        try {
          connection = await connect({ servers, name: 'harness-agent-spawn', timeout: 2000, drainTimeout: 5000, maxReconnectAttempts: -1, reconnectTimeWait: 1000 })
          if (stopping) {
            await connection.close()
            break
          }
          subscription = connection.subscribe(subject, { queue: 'harness-agent-spawn', callback: receive })
          await connection.flush()
          process.stdout.write('agent-spawn: listening for spawn requests\n')
          const error = await connection.closed()
          if (error && !stopping) report(error)
        } catch (error) {
          if (!stopping) report(error)
          await connection?.close()
        } finally {
          subscription = null
          connection = null
        }
        if (!stopping) await new Promise(resolve => {
          resumeRetry = resolve
          retryTimer = setTimeout(resolve, 1000)
        })
      }
      await shutdown
    } finally {
      process.removeListener('SIGTERM', stop)
      process.removeListener('SIGINT', stop)
    }
  }

  return { start, stop }
}

createWorker().start().catch(error => {
  process.stderr.write(`agent-spawn: ${error.stack || error}\n`)
  process.exitCode = 1
})
