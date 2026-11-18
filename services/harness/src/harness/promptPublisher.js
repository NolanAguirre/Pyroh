const { connect, JSONCodec } = require('nats')
const { servers, promptSubject, timeout } = require('./spawnConfig')

const publishPrompt = async (event) => {
  let connection
  let timer
  let monitor
  let serverError
  try {
    connection = await connect({ servers, name: 'harness-prompt-publisher', timeout: Math.min(timeout, 5000), reconnect: false })
    const closed = connection.closed().then(error => {
      if (error) serverError = error
      return { done: true }
    })
    const statuses = connection.status()[Symbol.asyncIterator]()
    // Permission failures arrive asynchronously and may not reject flush.
    monitor = (async () => {
      while (!connection.isClosed()) {
        const status = await Promise.race([statuses.next(), closed])
        if (status.done) break
        if (status.value.type === 'error') serverError = new Error(String(status.value.data))
      }
    })().catch(error => { serverError = error })
    connection.publish(promptSubject, JSONCodec().encode({ ...event, version: 1 }))
    await Promise.race([
      connection.flush(),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`NATS prompt publish timed out after ${timeout}ms`)), timeout)
      }),
    ])
    await connection.close()
    await monitor
    if (serverError) throw serverError
  } catch (cause) {
    throw Object.assign(new Error(`Failed to publish prompt for ${event.sessionId}/${event.runId} to ${promptSubject}: ${cause.message}`, { cause }),
      { code: 'PROMPT_PUBLISH_FAILED', status: 503 })
  } finally {
    clearTimeout(timer)
    await connection?.close()
    await monitor
  }
}

module.exports = { publishPrompt }
