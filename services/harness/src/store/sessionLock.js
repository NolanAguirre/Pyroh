const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const paths = require('./paths')

const held = new Map()

const identity = (pid = process.pid) => {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
    const start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]
    return `${fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}:${start}`
  } catch { return null }
}

const ownerAlive = (owner) => {
  if (!owner?.pid) return false
  if (owner.identity) return identity(owner.pid) === owner.identity
  try { process.kill(owner.pid, 0); return true } catch (err) { return err.code === 'EPERM' }
}

// flock locks the inherited open-file description. Keeping our descriptor open
// retains the lock after flock exits; the kernel releases it on process death.
// Never unlink the lock file: another process may already have it open.
const acquire = (sessionId, writeDir) => {
  const file = path.join(paths.sessionDir(sessionId, writeDir), 'session.lock')
  if (held.has(file)) return held.get(file)
  if (!fs.existsSync(paths.sessionFile(sessionId, writeDir))) throw new Error(`session not found: ${sessionId}`)
  const inherited = process.env.HARNESS_LOCK_FILE === file
  if (!inherited) {
    let owner
    try { owner = JSON.parse(fs.readFileSync(paths.daemonPid(sessionId, writeDir), 'utf8')) } catch (err) { if (err.code !== 'ENOENT') throw err }
    if (owner?.pid && owner.pid !== process.pid) {
      if (ownerAlive(owner)) {
        const err = new Error(`Session ${sessionId} already has an active run`)
        err.status = 409
        throw err
      }
    }
  }
  const fd = inherited ? 3 : fs.openSync(file, 'a', 0o600)
  if (!inherited) {
    const result = spawnSync('flock', ['--nonblock', '3'], { stdio: ['ignore', 'pipe', 'pipe', fd] })
    if (result.error || result.status !== 0) {
      fs.closeSync(fd)
      const err = new Error(result.error ? `Cannot lock session: ${result.error.message}` : `Session ${sessionId} already has an active run`)
      err.status = result.error ? 500 : 409
      throw err
    }
  }
  delete process.env.HARNESS_LOCK_FILE
  const lock = {
    spawnOptions: () => ({ stdio: ['ignore', 'ignore', 'ignore', fd], env: { ...process.env, HARNESS_LOCK_FILE: file } }),
    release: () => {
      if (held.get(file) !== lock) return
      held.delete(file)
      fs.closeSync(fd)
    },
  }
  held.set(file, lock)
  return lock
}

module.exports = { acquire, identity, ownerAlive }
