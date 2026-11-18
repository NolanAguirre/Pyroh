const fs = require('node:fs')
const { connect, JSONCodec } = require('nats')
const { servers, subject, timeout } = require('./spawnConfig')
const { validateRequest, validateReply, serializeError, VERSION } = require('./spawnProtocol')

// The existing spawn API is synchronous. Keep network IO in this short-lived
// helper so the caller can hold its locks without blocking the NATS client.
const main = async () => {
  const request = validateRequest(JSON.parse(fs.readFileSync(0, 'utf8')))
  const codec = JSONCodec()
  let connection
  let reply
  try {
    connection = await connect({ servers, name: 'harness-spawn-request', timeout: Math.min(timeout, 5000), reconnect: false })
    const message = await connection.request(subject, codec.encode(request), { timeout })
    reply = codec.decode(message.data)
    validateReply(reply, request)
  } catch (error) {
    reply = { version: VERSION, requestId: request.requestId, sessionId: request.sessionId, ok: false, error: serializeError(error) }
  } finally {
    await connection?.close()
  }
  process.stdout.write(JSON.stringify(reply))
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
