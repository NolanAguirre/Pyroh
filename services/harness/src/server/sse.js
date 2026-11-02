const fs = require('fs')
const path = require('path')
const config = require('../config')
const paths = require('../store/paths')
const eventLog = require('../store/eventLog')
const sessionStore = require('../store/sessionStore')
const questionStore = require('../store/questionStore')
const queuedMessageStore = require('../store/queuedMessageStore')

const feeds = new Map()
const fingerprint = (stat) => stat ? `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}` : 'missing'
const statOrMissing = async (file) => {
  try { return await fs.promises.stat(file) }
  catch (err) { if (err.code === 'ENOENT') return null; throw err }
}

// Share metadata reads and watches across browser tabs viewing the same session.
// Atomic record writes change the containing directory; idle histories need only stats.
const createFeed = (sessionId, writeDir, initialSession, onDispose) => {
  const dir = paths.sessionDir(sessionId, writeDir)
  const locations = {
    session: paths.sessionFile(sessionId, writeDir),
    runs: paths.runsDir(sessionId, writeDir),
    questions: paths.questionsDir(sessionId, writeDir),
    children: path.join(dir, 'delegation'),
    queuedMessages: queuedMessageStore.fileFor(sessionId, writeDir),
    events: paths.eventsFile(sessionId, writeDir),
  }
  const listeners = new Set()
  const watchers = new Map()
  const stamps = new Map()
  const frames = new Map()
  const dirty = new Set(Object.keys(locations))
  let session = initialSession
  let children = []
  let events = { stamp: 'missing', size: 0 }
  let ready = false
  let disposed = false
  let refreshing = null
  let pending = false
  let scheduled = null

  const schedule = () => {
    if (disposed || scheduled) return
    scheduled = setTimeout(() => {
      scheduled = null
      refresh().catch(() => {})
    }, 25)
  }

  const watch = (directory, type) => {
    if (watchers.has(directory) || disposed) return
    try {
      const watcher = fs.watch(directory, (_event, filename) => {
        const name = filename?.toString()
        if (type) dirty.add(type)
        else if (name === 'session.json') dirty.add('session')
        else if (name === 'queued-messages.json') dirty.add('queuedMessages')
        else if (name && !['events.jsonl', 'runs', 'questions', 'delegation'].includes(name)) return
        schedule()
      })
      watcher.on('error', () => {
        watcher.close()
        watchers.delete(directory)
      })
      watchers.set(directory, watcher)
    } catch {
      // Missing directories and unsupported watches are covered by polling.
    }
  }

  const refresh = () => {
    if (disposed) return Promise.resolve()
    if (refreshing) {
      pending = true
      return refreshing
    }
    const requested = new Set(dirty)
    dirty.clear()
    refreshing = (async () => {
      const entries = await Promise.all(Object.entries(locations).map(async ([type, file]) =>
        [type, await statOrMissing(file)]))
      const changed = new Set(entries.filter(([type, stat]) =>
        requested.has(type) || stamps.get(type) !== fingerprint(stat)).map(([type]) => type))
      // Workspace changes can update the resolved session cwd without rewriting it.
      const workspaceStamp = session.workspaceId
        ? fingerprint(await statOrMissing(paths.workspaceFile(session.workspaceId, writeDir))) : 'missing'
      if (stamps.get('workspace') !== workspaceStamp) changed.add('session')
      const updates = await Promise.all([
        changed.has('session') ? sessionStore.loadSessionAsync(sessionId, writeDir).then(value => ['session', value]) : null,
        changed.has('runs') ? sessionStore.listRunsAsync(sessionId, writeDir).then(value => ['runs', value]) : null,
        changed.has('questions') ? questionStore.listQuestionsAsync(sessionId, writeDir).then(value => ['questions', value]) : null,
        changed.has('queuedMessages') ? queuedMessageStore.listAsync(sessionId, writeDir).then(value => ['queuedMessages', value]) : null,
        changed.has('children') || changed.has('runs') || children.some(child => !child.done)
          ? require('../harness/delegation').childrenForAsync(sessionId).then(value => ['children', value]) : null,
      ])
      if (disposed) return
      let updated = !ready
      for (const entry of updates) {
        if (!entry) continue
        const [type, value] = entry
        if (type === 'session') {
          if (!value) continue
          session = value
        }
        if (type === 'children') children = value
        const frame = `event: ${type}\ndata: ${JSON.stringify(value)}\n\n`
        if (frames.get(type) !== frame) {
          frames.set(type, frame)
          updated = true
        }
      }
      for (const [type, stat] of entries) {
        const stamp = fingerprint(stat)
        if (type === 'events' && events.stamp !== stamp) {
          events = { stamp, size: stat?.size || 0 }
          updated = true
        }
        stamps.set(type, stamp)
        if (stat && ['runs', 'questions', 'children'].includes(type)) watch(locations[type], type)
      }
      stamps.set('workspace', workspaceStamp)
      watch(dir)
      ready = true
      if (updated) for (const listener of listeners) listener()
    })().catch(err => {
      for (const type of requested) dirty.add(type)
      throw err
    }).finally(() => {
      refreshing = null
      if (pending) {
        pending = false
        schedule()
      }
    })
    return refreshing
  }

  const poll = setInterval(() => { refresh().catch(() => {}) }, 1000)
  return {
    refresh,
    snapshot: () => ({ ready, frames: new Map(frames), events }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        if (listeners.size) return
        disposed = true
        clearInterval(poll)
        clearTimeout(scheduled)
        for (const watcher of watchers.values()) watcher.close()
        onDispose()
      }
    },
  }
}

const streamSession = async (req, res, sessionId) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  if (typeof res.flushHeaders === 'function') res.flushHeaders()

  let closed = false
  let unsubscribe = null
  let heartbeat = null
  const cleanup = () => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    unsubscribe?.()
  }
  req.on('close', cleanup)
  res.on('close', cleanup)
  res.on('error', cleanup)

  const write = async (frame) => {
    if (closed) return
    if (res.write(frame)) return
    await new Promise(resolve => {
      const done = () => {
        res.off('drain', done)
        res.off('close', done)
        res.off('error', done)
        resolve()
      }
      res.once('drain', done)
      res.once('close', done)
      res.once('error', done)
      if (closed) done()
    })
  }

  const writeDir = config.writeDir
  const session = await sessionStore.loadSessionAsync(sessionId, writeDir)
  if (closed) return
  if (!session) {
    await write(`event: error\ndata: ${JSON.stringify({ message: `session not found: ${sessionId}` })}\n\n`)
    cleanup()
    res.end()
    return
  }

  const key = `${writeDir}\0${sessionId}`
  let feed = feeds.get(key)
  if (!feed) {
    feed = createFeed(sessionId, writeDir, session, () => feeds.delete(key))
    feeds.set(key, feed)
  }

  const cursor = String(req.headers['last-event-id'] || '')
  let offset = /^\d+$/.test(cursor) && Number.isSafeInteger(Number(cursor)) ? Number(cursor) : 0
  let eventStamp = null
  const sent = new Map()
  let sending = false
  let pending = false
  let readySent = false
  const flush = async () => {
    if (closed) return
    if (sending) { pending = true; return }
    sending = true
    try {
      do {
        pending = false
        const snapshot = feed.snapshot()
        if (!snapshot.ready) break
        // Surface session metadata promptly while a large transcript is replaying.
        for (const [type, frame] of snapshot.frames) {
          if (sent.get(type) === frame) continue
          await write(frame)
          sent.set(type, frame)
        }
        if (snapshot.events.stamp !== eventStamp) {
          if (offset > snapshot.events.size) {
            offset = 0
            await write('id: 0\nevent: reset\ndata: {}\n\n')
          }
          while (!closed && offset < snapshot.events.size) {
            const batch = await eventLog.readFromAsync(sessionId, offset, writeDir, {
              maxBytes: 256 * 1024, end: snapshot.events.size,
            })
            for (let index = 0; index < batch.events.length && !closed; index += 1) {
              await write(`id: ${batch.offsets[index]}\nevent: event\ndata: ${JSON.stringify(batch.events[index])}\n\n`)
            }
            if (batch.offset <= offset) break
            offset = batch.offset
            await new Promise(resolve => setImmediate(resolve))
          }
          eventStamp = snapshot.events.stamp
        }
        if (!readySent && !closed) {
          await write(`event: ready\ndata: ${JSON.stringify({ sessionId })}\n\n`)
          readySent = true
        }
      } while (pending && !closed)
    } catch {
      cleanup()
      res.end()
    } finally { sending = false }
  }

  unsubscribe = feed.subscribe(() => { flush() })
  try {
    await feed.refresh()
    await flush()
  } catch {
    cleanup()
    res.end()
    return
  }
  if (closed) return
  heartbeat = setInterval(() => {
    if (!sending && !res.writableNeedDrain) res.write(': ping\n\n')
  }, 15000)
}

module.exports = { streamSession }
