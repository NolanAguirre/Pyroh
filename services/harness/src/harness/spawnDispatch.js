const fs = require('node:fs')
const config = require('../config')
const paths = require('../store/paths')
const sessionLock = require('../store/sessionLock')
const store = require('../store/sessionStore')
const proc = require('./process')
const { withRecord } = require('./spawnRecord')
const { VERSION, failure, validateRequest, validateArgs, serializeError } = require('./spawnProtocol')

const createSpawnDispatcher = () => {
  const dispatch = (input) => {
    const request = validateRequest(input)
    return withRecord(request, (record, save) => {
      if (!record || record.requestId !== request.requestId || record.sessionId !== request.sessionId) {
        throw failure('Agent spawn request is no longer pending', 'SPAWN_EXPIRED', 409)
      }
      if (record.reply) return record.reply
      if (record.state !== 'pending') throw failure('Agent spawn outcome is unknown; inspect the session before retrying', 'SPAWN_UNCERTAIN')
      let lock
      let reply
      try {
        if (record.expiresAt <= Date.now() || !sessionLock.ownerAlive(record.owner)) {
          throw failure('Agent spawn request expired', 'SPAWN_EXPIRED', 503)
        }
        const args = validateArgs(record.args)
        if (args[1] !== request.sessionId) throw failure('Agent spawn session mismatch', 'SPAWN_PROTOCOL', 400)
        // The caller still owns this lease. Take our own named-pipe handles and
        // pass only our local FDs to the daemon, preserving the continuous lock.
        lock = sessionLock.acquire(request.sessionId, config.writeDir, { exclusive: true, sharedLease: record.pipes })
        const session = store.loadSession(request.sessionId, config.writeDir)
        if (!session) throw Object.assign(new Error(`session not found: ${request.sessionId}`), { status: 404 })
        if (fs.existsSync(paths.controlFile(request.sessionId, config.writeDir)) ||
            fs.existsSync(paths.runAfterCancelFile(request.sessionId, config.writeDir))) {
          throw Object.assign(new Error('stopped'), { code: 'stopped' })
        }
        if (args[0] !== 'workflow' && !store.loadRun(request.sessionId, args[3], config.writeDir)) {
          throw Object.assign(new Error(`run not found: ${args[3]}`), { status: 404 })
        }
        if (record.expiresAt <= Date.now()) throw failure('Agent spawn request expired', 'SPAWN_EXPIRED', 503)
        save({ ...record, state: 'launching' })
        const pid = proc.spawnHarness(args, lock.spawnOptions())
        reply = { version: VERSION, requestId: request.requestId, sessionId: request.sessionId, ok: true, pid }
      } catch (error) {
        reply = { version: VERSION, requestId: request.requestId, sessionId: request.sessionId, ok: false, error: serializeError(error) }
      } finally {
        lock?.release()
      }
      save({ ...record, state: reply.ok ? 'launched' : 'failed', reply })
      return reply
    })
  }
  return { dispatch }
}

module.exports = { createSpawnDispatcher }
