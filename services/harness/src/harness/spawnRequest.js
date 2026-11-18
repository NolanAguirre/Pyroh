const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const sessionLock = require('../store/sessionLock')
const { timeout } = require('./spawnConfig')
const { withRecord } = require('./spawnRecord')
const { VERSION, failure, validateArgs, validateReply, serializeError } = require('./spawnProtocol')

const requestSpawn = (args, lock) => {
  validateArgs(args)
  const request = { version: VERSION, requestId: randomUUID(), sessionId: args[1] }
  withRecord(request, (previous, save) => save({
    ...request, args, pipes: lock.share(),
    owner: { pid: process.pid, identity: sessionLock.identity() },
    expiresAt: Date.now() + timeout + 5000,
    state: 'pending',
  }))
  let error
  try {
    const child = spawnSync(process.execPath, [path.join(__dirname, 'spawnTransport.js')], {
      input: JSON.stringify(request), encoding: 'utf8',
      timeout: timeout + 6000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
    })
    if (child.error || child.status !== 0) {
      throw failure(child.error?.message || child.stderr?.trim() || 'Agent spawn transport failed', 'SPAWN_UNAVAILABLE')
    }
    return validateReply(JSON.parse(child.stdout), request)
  } catch (cause) {
    error = cause
  }
  // Cancel under the same lock used by the worker. A late NATS request cannot
  // launch after an error is returned, and a lost success reply stays success.
  return withRecord(request, (record, save) => {
    if (record?.requestId !== request.requestId) throw failure('Agent spawn receipt was replaced')
    if (record.reply) return validateReply(record.reply, request)
    if (record.state === 'launching') {
      throw failure('Agent spawn outcome is unknown; inspect the session before retrying', 'SPAWN_UNCERTAIN')
    }
    const reported = error.status ? error : failure(`Agent spawn request failed: ${error.message}`, error.code || 'SPAWN_UNAVAILABLE')
    save({ ...record, state: 'cancelled', reply: { ...request, ok: false, error: serializeError(reported) } })
    throw reported
  })
}

module.exports = { requestSpawn }
