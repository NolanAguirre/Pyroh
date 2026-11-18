const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')
const { connect, JSONCodec } = require('nats')
const config = require('../config')
const paths = require('./paths')
const fileLock = require('./fileLock')
const { readJson, writeJson, ensureDir } = require('./jsonFile')
const { loadSession } = require('./sessionRecord')
const { natsConfig } = require('../harness/natsConfig')

const pumps = new Map()
const retries = new Map()
const report = error => process.stderr.write(`question lifecycle: ${error.message || error}\n`)
const queueDir = (writeDir, storageKey) => path.join(writeDir, 'question-lifecycle', storageKey)

// Question writers cannot take the session lock held by a waiting daemon.
const withQuestionLock = (sessionId, questionId, writeDir, change, options) => {
  ensureDir(paths.questionsDir(sessionId, writeDir))
  const lease = fileLock.acquire(`${paths.questionFile(sessionId, questionId, writeDir)}.lock`, options)
  try { return change() }
  finally { lease.release() }
}

// Call under the question lock. Prepare before committing, as for run events.
// Only metadata travels through NATS, including for secret answers/approvals.
const writeRecord = (sessionId, record, writeDir = config.writeDir, beforeCommit = () => {}) => {
  const file = paths.questionFile(sessionId, record.id, writeDir)
  const previous = readJson(file)
  const events = previous?.lifecycleEvents || []
  const type = record.status === 'pending' ? 'requested' : record.status
  if (previous?.status === record.status) return writeJson(file, record)
  const transport = natsConfig({ writeDir, dbPath: config.dbPath })
  const session = loadSession(sessionId, writeDir)
  const eventId = randomUUID()
  const sequence = events.length + 1
  const at = record.answeredAt || record.cancelledAt || record.expiredAt || record.createdAt
  const event = {
    version: 1, eventId, sequence, type, at, storageKey: transport.storageKey,
    sessionId, questionId: record.id, runId: record.runId || null,
    kind: record.kind, parentSessionId: session?.parentSessionId || null,
    parentRunId: session?.parentRunId || null,
  }
  const next = { ...record, lifecycleEvents: [...events, { eventId, sequence, type, at }] }
  writeJson(path.join(queueDir(writeDir, transport.storageKey), `${eventId}.json`), {
    event, queuedAt: Date.now(),
  })
  beforeCommit()
  writeJson(file, next)
  setImmediate(() => { flush(writeDir).catch(report) })
  return next
}

const publishPending = async writeDir => {
  const transport = natsConfig({ writeDir, dbPath: config.dbPath })
  const directory = queueDir(writeDir, transport.storageKey)
  ensureDir(directory)
  let lease
  try { lease = fileLock.acquire(path.join(directory, 'publish.lock'), { nonblock: true }) }
  catch (error) {
    if (error.code === 'LOCK_BUSY') return false
    throw error
  }
  let connection
  let monitor
  let serverError
  let timer
  let complete = true
  const published = []
  try {
    const pending = fs.readdirSync(directory).filter(name => name.endsWith('.json'))
      .map(name => ({ name, ...readJson(path.join(directory, name)) }))
      .sort((a, b) => a.queuedAt - b.queuedAt || a.event.sequence - b.event.sequence)
    const codec = JSONCodec()
    for (const { name, event } of pending) {
      let committed
      try {
        committed = withQuestionLock(event.sessionId, event.questionId, writeDir, () => {
          const question = readJson(paths.questionFile(event.sessionId, event.questionId, writeDir))
          if (question?.lifecycleEvents?.some(entry => entry.eventId === event.eventId)) return true
          const saved = event.type === 'answered' && question?.status === 'pending' &&
            readJson(paths.answerFile(event.sessionId, event.questionId, writeDir))
          // An answer file is a durable receipt if its writer died before
          // committing the question. Finish that exact prepared transition.
          if (saved?.id === event.questionId && saved.answeredAt === event.at) {
            const { eventId, sequence, type, at } = event
            writeJson(paths.questionFile(event.sessionId, event.questionId, writeDir), {
              ...question, status: 'answered', answer: saved.answer, answeredAt: saved.answeredAt,
              lifecycleEvents: [...(question.lifecycleEvents || []), { eventId, sequence, type, at }],
            })
            return true
          }
          fs.rmSync(path.join(directory, name), { force: true })
          return false
        }, { nonblock: true })
      } catch (error) {
        if (error.code !== 'LOCK_BUSY') throw error
        complete = false
        continue
      }
      if (!committed) continue
      if (!connection) {
        connection = await connect({ servers: transport.servers, name: 'harness-question-lifecycle-publisher',
          timeout: Math.min(transport.timeout, 5000), reconnect: false })
        monitor = (async () => {
          for await (const status of connection.status()) {
            if (status.type === 'error') serverError = new Error(String(status.data))
          }
        })().catch(error => { serverError = error })
        connection.closed().then(error => { if (error) serverError = error }).catch(error => { serverError = error })
      }
      connection.publish(transport.questionLifecycleSubject, codec.encode({ ...event, publishedAt: Date.now() }))
      try {
        await Promise.race([
          connection.flush(),
          new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error('NATS question lifecycle publish timed out')), Math.min(transport.timeout, 5000))
          }),
        ])
      } finally { clearTimeout(timer) }
      if (serverError) throw serverError
      published.push(name)
    }
    await connection?.close()
    await monitor
    if (serverError) throw serverError
    for (const name of published) fs.rmSync(path.join(directory, name), { force: true })
    return complete
  } catch (cause) {
    throw Object.assign(new Error(`Publish to ${transport.questionLifecycleSubject} failed: ${cause.message}. Pending events retained for retry.`, { cause }),
      { code: 'QUESTION_LIFECYCLE_PUBLISH_FAILED' })
  } finally {
    clearTimeout(timer)
    try {
      await connection?.close()
      await monitor
    } finally { lease.release() }
  }
}

const retry = writeDir => {
  if (retries.has(writeDir)) return
  const timer = setTimeout(() => {
    retries.delete(writeDir)
    flush(writeDir).catch(report)
  }, 1000)
  timer.unref()
  retries.set(writeDir, timer)
}

const flush = (writeDir = config.writeDir) => {
  const active = pumps.get(writeDir)
  if (active) {
    active.again = true
    return active.promise
  }
  clearTimeout(retries.get(writeDir))
  retries.delete(writeDir)
  const pump = { again: false, promise: null }
  pumps.set(writeDir, pump)
  pump.promise = (async () => {
    do {
      pump.again = false
      if (!await publishPending(writeDir)) retry(writeDir)
    } while (pump.again)
  })().catch(error => {
    retry(writeDir)
    throw error
  }).finally(() => pumps.delete(writeDir))
  return pump.promise
}

module.exports = { withQuestionLock, writeRecord, flush }
