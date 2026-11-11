const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn, spawnSync } = require('child_process')

const HOLDER = path.resolve(__dirname, '../../scripts/hold-file-lock')

const readStatus = (fd) => {
  const byte = Buffer.alloc(1)
  let line = ''
  while (fs.readSync(fd, byte, 0, 1, null)) {
    if (byte[0] === 10) return Number(line)
    line += byte.toString()
  }
  throw new Error('File lock holder exited without reporting its status')
}

// The writer is a lease, not the lock itself. Passing both descriptors to a
// daemon keeps the holder alive and lets the last owner await actual release.
const fromDescriptors = (fd, statusFd) => {
  let released = false
  return {
    fd,
    statusFd,
    release: ({ wait = true } = {}) => {
      if (released) return
      released = true
      try {
        fs.closeSync(fd)
        if (wait) readStatus(statusFd)
      } finally {
        fs.closeSync(statusFd)
      }
    },
  }
}

const acquire = (file, { nonblock = false, timeout = 1000 } = {}) => {
  // Never unlink the lock file: another process may already be waiting on it.
  fs.closeSync(fs.openSync(file, 'a', 0o600))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-lock-'))
  const control = path.join(dir, 'control')
  const status = path.join(dir, 'status')
  const errorFile = path.join(dir, 'error')
  let child
  let fd
  let statusFd
  let errorFd
  try {
    const fifo = spawnSync('mkfifo', ['-m', '600', control, status], { encoding: 'utf8' })
    if (fifo.error || fifo.status !== 0) throw fifo.error || new Error(fifo.stderr.trim() || 'Could not create lock pipes')
    errorFd = fs.openSync(errorFile, 'w', 0o600)
    child = spawn('/bin/sh', [HOLDER, control, status, path.resolve(file), ...(nonblock ? ['-n'] : ['-t', String(timeout)])], {
      detached: true,
      stdio: ['ignore', 'ignore', errorFd],
    })
    child.on('error', () => {})
    child.unref()
    if (!child.pid) throw new Error('Could not start file lock holder')
    fd = fs.openSync(control, 'w')
    statusFd = fs.openSync(status, 'r')
    const code = readStatus(statusFd)
    if (code !== 0) {
      const detail = fs.readFileSync(errorFile, 'utf8').trim()
      throw Object.assign(new Error(detail || `s6-setlock exited with status ${code}`), { code: code === 1 ? 'LOCK_BUSY' : 'LOCK_FAILED' })
    }
    return fromDescriptors(fd, statusFd)
  } catch (err) {
    if (fd !== undefined) fs.closeSync(fd)
    if (statusFd !== undefined) fs.closeSync(statusFd)
    if (child?.pid) {
      try { process.kill(-child.pid, 'SIGTERM') } catch {}
    }
    throw err
  } finally {
    if (errorFd !== undefined) fs.closeSync(errorFd)
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

module.exports = { acquire, fromDescriptors }
