const fs = require('fs')
const path = require('path')
const paths = require('./paths')
const fileLock = require('./fileLock')

const HARNESS_LOCK_FILE = process.env.HARNESS_LOCK_FILE
const held = new Map()
let inheritedClaimed = false
delete process.env.HARNESS_LOCK_FILE

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

// An inherited pipe keeps the s6-setlock holder alive across daemon handoff.
// The holder releases the lock when every owner's pipe closes, including death.
// Never unlink the lock file: another process may already have it open.
const lockPath = (sessionId, writeDir) => path.join(paths.sessionDir(sessionId, writeDir), 'session.lock')

const holds = (sessionId, writeDir) => held.has(lockPath(sessionId, writeDir))

const acquire = (sessionId, writeDir, { exclusive = false } = {}) => {
  const file = lockPath(sessionId, writeDir)
  if (held.has(file)) {
    const existing = held.get(file)
    if (exclusive || existing.exclusive) {
      throw Object.assign(new Error(`Session ${sessionId} is busy`), { status: 409 })
    }
    return existing
  }
  if (!fs.existsSync(paths.sessionFile(sessionId, writeDir))) throw new Error(`session not found: ${sessionId}`)
  const inherited = HARNESS_LOCK_FILE === file && !inheritedClaimed
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
  let lease
  try {
    lease = inherited ? fileLock.fromDescriptors(3, 4) : fileLock.acquire(file, { nonblock: true })
  } catch (cause) {
    const busy = cause.code === 'LOCK_BUSY'
    throw Object.assign(new Error(busy ? `Session ${sessionId} already has an active run` : `Cannot lock session: ${cause.message}`), { status: busy ? 409 : 500 })
  }
  if (inherited) inheritedClaimed = true
  let transferred = false
  const lock = {
    exclusive,
    spawnOptions: () => {
      transferred = true
      return { stdio: ['ignore', 'ignore', 'ignore', lease.fd, lease.statusFd], env: { ...process.env, HARNESS_LOCK_FILE: file } }
    },
    release: () => {
      if (held.get(file) !== lock) return
      held.delete(file)
      lease.release({ wait: !transferred })
    },
  }
  held.set(file, lock)
  return lock
}

module.exports = { acquire, holds, identity, ownerAlive }
