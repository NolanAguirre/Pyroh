const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const paths = require('./paths')
const { readJson, writeJson, ensureDir } = require('./jsonFile')

const genId = () => `steer_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`

// writeJson stages dotfiles before renaming; only settled records count.
const steerFiles = (dir) => {
  try {
    return fs.readdirSync(dir).filter((name) => name.endsWith('.json') && !name.startsWith('.'))
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

// Called by the API: drop a steer message into the mailbox.
const write = (sessionId, text, writeDir) => {
  const record = { id: genId(), text: String(text), createdAt: Date.now() }
  writeJson(path.join(paths.steerDir(sessionId, writeDir), `${record.id}.json`), record)
  return record
}

// Called by the daemon: claim every pending steer, oldest first.
const takePending = (sessionId, writeDir) => {
  const dir = paths.steerDir(sessionId, writeDir)
  const steers = []
  for (const name of steerFiles(dir)) {
    const file = path.join(dir, name)
    let record
    try {
      record = readJson(file, null)
    } catch {
      record = null
    }
    fs.rmSync(file, { force: true })
    if (record && typeof record.text === 'string') steers.push(record)
  }
  steers.sort((a, b) => a.createdAt - b.createdAt)
  return steers
}

// Fires onSteer whenever pending steers exist; returns stop(). fs.watch with a
// polling fallback.
const watch = (sessionId, writeDir, onSteer) => {
  const dir = paths.steerDir(sessionId, writeDir)
  ensureDir(dir)

  let stopped = false
  let watcher = null

  const check = () => {
    if (stopped) return
    if (steerFiles(dir).length > 0) onSteer()
  }

  try {
    watcher = fs.watch(dir, () => check())
  } catch {
    // fs.watch unsupported on this platform; polling covers it.
  }
  const timer = setInterval(check, 500)
  check()

  const stop = () => {
    if (stopped) return
    stopped = true
    clearInterval(timer)
    if (watcher) {
      try {
        watcher.close()
      } catch {
        // ignore
      }
      watcher = null
    }
  }

  return stop
}

module.exports = { write, takePending, watch }
