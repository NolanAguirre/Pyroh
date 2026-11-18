const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')
const { connect, JSONCodec } = require('nats')
const config = require('../config')
const { readJson, writeJson, ensureDir } = require('./jsonFile')
const { loadSession } = require('./sessionRecord')
const locks = require('./sessionLock')
const fileLock = require('./fileLock')
const { natsConfig } = require('../harness/natsConfig')

const pumps = new Map()
const typeOf = (run) => {
  if (!run) return null
  if (run.status === 'running' && !run.endedAt) return 'started'
  if (run.status === 'completed') return 'completed'
  if (run.status === 'cancelled') return 'cancelled'
  if (['error', 'disconnected', 'interrupted', 'failed'].includes(run.status)) return 'failed'
  return null
}
const report = (error) => process.stderr.write(`run lifecycle: ${error.message || error}\n`)
const queueDir = (writeDir, storageKey) => path.join(writeDir, 'run-lifecycle', storageKey)

// Prepare the outbox before the atomic run write. Only IDs committed in that
// record can be published, so a crash cannot publish an uncommitted transition.
const writeRun = (file, record, writeDir = config.writeDir) => {
  const previous = readJson(file)
  const sameRun = previous?.id === record.id
  const events = sameRun ? previous.lifecycleEvents || [] : []
  const type = typeOf(record)
  const changed = type && (!sameRun || type !== typeOf(previous))
  const next = { ...record, ...(events.length ? { lifecycleEvents: events } : {}) }
  if (changed) {
    const session = loadSession(record.sessionId, writeDir)
    const transport = natsConfig({ writeDir, dbPath: config.dbPath })
    const at = type === 'started' ? (sameRun ? Date.now() : record.startedAt) : record.endedAt || Date.now()
    const eventId = randomUUID()
    const sequence = events.length + 1
    const event = {
      version: 1, eventId, sequence, type, at, storageKey: transport.storageKey,
      sessionId: record.sessionId, runId: record.id,
      parentSessionId: record.parentSessionId || session?.parentSessionId || null,
      parentRunId: record.parentRunId || session?.parentRunId || null,
      rootSessionId: record.rootSessionId || session?.rootSessionId || record.sessionId,
      workspaceId: session?.workspaceId || null,
      childKind: session?.childKind || null, depth: session?.depth ?? 0,
      lineage: session?.lineage || [], scope: record.step ? 'step' : 'run',
      provider: session?.provider || null, model: session?.model || null,
      mode: record.mode, step: record.step || null, phase: record.phase ?? null,
      status: record.status, startedAt: record.startedAt, endedAt: record.endedAt || null,
      durationMs: record.durationMs || 0, error: record.error || null,
      localCommand: record.localCommand || null,
    }
    next.lifecycleEvents = [...events, { eventId, sequence, type, at }]
    writeJson(path.join(queueDir(writeDir, transport.storageKey), `${eventId}.json`), {
      file: path.resolve(file), event, queuedAt: Date.now(),
    })
  }
  writeJson(file, next)
  if (changed) setImmediate(() => { flush(writeDir).catch(report) })
  return next
}

const publishPending = async (writeDir) => {
  const transport = natsConfig({ writeDir, dbPath: config.dbPath })
  const directory = queueDir(writeDir, transport.storageKey)
  ensureDir(directory)
  let lease
  try { lease = fileLock.acquire(path.join(directory, 'publish.lock'), { nonblock: true }) }
  catch (error) {
    if (error.code === 'LOCK_BUSY') return
    throw error
  }
  let connection
  let monitor
  let serverError
  let timer
  const published = []
  try {
    const pending = fs.readdirSync(directory).filter(name => name.endsWith('.json'))
      .map(name => ({ name, ...readJson(path.join(directory, name)) }))
      .sort((a, b) => a.queuedAt - b.queuedAt || a.event.sequence - b.event.sequence)
    const codec = JSONCodec()
    for (const item of pending) {
      const { event, file } = item
      const run = readJson(file)
      if (!run?.lifecycleEvents?.some(entry => entry.eventId === event.eventId)) {
        // A writer may still be between preparing the event and committing it.
        // Leave uncommitted records for a later pass while its lock is held.
        if (locks.holds(event.sessionId, writeDir)) continue
        let sessionLease
        try { sessionLease = locks.acquire(event.sessionId, writeDir, { exclusive: true }) }
        catch (error) {
          if (error.status === 409) continue
          if (loadSession(event.sessionId, writeDir)) throw error
        }
        try {
          if (readJson(file)?.lifecycleEvents?.some(entry => entry.eventId === event.eventId)) continue
          fs.rmSync(path.join(directory, item.name), { force: true })
        } finally { sessionLease?.release() }
        continue
      }
      let sessionLease
      if (event.type !== 'started' && event.scope !== 'step') {
        if (locks.holds(event.sessionId, writeDir)) continue
        try { sessionLease = locks.acquire(event.sessionId, writeDir, { exclusive: true }) }
        catch (error) {
          if (error.status === 409) continue
          throw error
        }
      }
      let payload
      try {
        const session = loadSession(event.sessionId, writeDir)
        payload = { ...event, sessionStatus: session?.status || null,
          sessionUpdatedAt: session?.updatedAt || null, publishedAt: Date.now() }
      } finally { sessionLease?.release() }
      if (!connection) {
        connection = await connect({ servers: transport.servers, name: 'harness-run-lifecycle-publisher',
          timeout: Math.min(transport.timeout, 5000), reconnect: false })
        monitor = (async () => {
          for await (const status of connection.status()) {
            if (status.type === 'error') serverError = new Error(String(status.data))
          }
        })().catch(error => { serverError = error })
        connection.closed().then(error => { if (error) serverError = error }).catch(error => { serverError = error })
      }
      connection.publish(transport.lifecycleSubject, codec.encode(payload))
      try {
        await Promise.race([
          connection.flush(),
          new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error('NATS lifecycle publish timed out')), Math.min(transport.timeout, 5000))
          }),
        ])
      } finally { clearTimeout(timer) }
      if (serverError) throw serverError
      published.push(item.name)
    }
    await connection?.close()
    await monitor
    if (serverError) throw serverError
    for (const name of published) fs.rmSync(path.join(directory, name), { force: true })
  } catch (cause) {
    throw Object.assign(new Error(`Publish to ${transport.lifecycleSubject} failed: ${cause.message}. Pending events retained for retry.`, { cause }),
      { code: 'RUN_LIFECYCLE_PUBLISH_FAILED' })
  } finally {
    clearTimeout(timer)
    try {
      await connection?.close()
      await monitor
    } finally { lease.release() }
  }
}

const flush = (writeDir = config.writeDir) => {
  const active = pumps.get(writeDir)
  if (active) {
    active.again = true
    return active.promise
  }
  const pump = { again: false, promise: null }
  pumps.set(writeDir, pump)
  pump.promise = (async () => {
    do {
      pump.again = false
      await publishPending(writeDir)
    } while (pump.again)
  })().finally(() => pumps.delete(writeDir))
  return pump.promise
}

module.exports = { writeRun, flush }
