const fs = require('fs')
const config = require('../config')
const paths = require('../store/paths')
const eventLog = require('../store/eventLog')
const sessionStore = require('../store/sessionStore')
const questionStore = require('../store/questionStore')

const writeDir = () => config.writeDir

// Open a Server-Sent Events stream for a session: replay the event log, then
// tail new events plus session/run/question changes via fs.watch + polling.
const streamSession = async (req, res, sessionId) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  if (typeof res.flushHeaders === 'function') res.flushHeaders()

  let closed = false
  let watcher = null
  let poll = null
  let heartbeat = null
  const cleanup = () => {
    closed = true
    clearInterval(poll)
    clearInterval(heartbeat)
    if (watcher) {
      try {
        watcher.close()
      } catch {
        // ignore
      }
    }
  }
  req.on('close', cleanup)
  res.on('close', cleanup)

  const send = (type, data) => {
    if (closed) return
    res.write(`event: ${type}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  // Only resend runs/questions when their content changed.
  const sendChanged = (() => {
    const last = new Map()
    return (type, data) => {
      const json = JSON.stringify(data)
      if (last.get(type) === json) return
      last.set(type, json)
      send(type, data)
    }
  })()

  const session = await sessionStore.loadSessionAsync(sessionId, writeDir())
  if (!session) {
    send('error', { message: `session not found: ${sessionId}` })
    res.end()
    return
  }

  // A daemon killed without finalizing leaves the session "running"; recover
  // it here (only takes the session lock when the daemon is gone).
  const Harness = require('../harness/Harness')
  const recover = async () => {
    try {
      const s = await sessionStore.loadSessionAsync(sessionId, writeDir())
      if (s) Harness.recoverDeadDaemon(s, await Harness.daemonPidOfAsync(sessionId))
    } catch {
      // retried on the next poll
    }
  }

  let lastSessionUpdatedAt = 0
  const pushSession = async () => {
    const s = await sessionStore.loadSessionAsync(sessionId, writeDir())
    if (s && s.updatedAt !== lastSessionUpdatedAt) {
      lastSessionUpdatedAt = s.updatedAt
      send('session', s)
    }
  }

  const pushRuns = async () => sendChanged('runs', await sessionStore.listRunsAsync(sessionId, writeDir()))
  const pushQuestions = async () => sendChanged('questions', await questionStore.listQuestionsAsync(sessionId, writeDir()))

  let offset = 0
  const tail = async () => {
    const { events, offset: next } = await eventLog.readFromAsync(sessionId, offset, writeDir())
    for (const event of events) send('event', event)
    offset = next
  }

  // Replay existing events, then remember the byte offset for tailing.
  await tail()
  await Promise.all([pushSession(), pushRuns(), pushQuestions()])
  send('ready', { sessionId })
  if (closed) return

  // Serialize refreshes: watch events and the poll can fire while one is in flight.
  let refreshing = null
  let pending = false
  const refresh = async ({ recoverDaemon = false } = {}) => {
    if (refreshing) {
      pending = true
      return refreshing
    }
    refreshing = (async () => {
      do {
        pending = false
        if (recoverDaemon) await recover()
        await tail()
        await Promise.all([pushSession(), pushRuns(), pushQuestions()])
      } while (pending && !closed)
    })()
    try {
      await refreshing
    } catch {
      // retried on the next poll
    } finally {
      refreshing = null
    }
  }

  try {
    watcher = fs.watch(paths.sessionDir(sessionId, writeDir()), () => { refresh() })
  } catch {
    // fs.watch unsupported; polling covers it.
  }

  poll = setInterval(() => { refresh({ recoverDaemon: true }) }, 1000)
  heartbeat = setInterval(() => res.write(': ping\n\n'), 15000)
}

module.exports = { streamSession }
