const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn, spawnSync } = require('child_process')

const HOLDER = path.resolve(__dirname, '../../scripts/hold-file-lock')
const HANDSHAKE_TIMEOUT = 1000
const RELEASE_TIMEOUT = 1000
const pause = new Int32Array(new SharedArrayBuffer(4))
const now = () => Number(process.hrtime.bigint() / 1000000n)
const lockError = (code, message) => Object.assign(new Error(message), { code })

const remaining = (deadline, phase) => {
  const milliseconds = deadline - now()
  if (milliseconds <= 0) throw lockError('LOCK_TIMEOUT', `File lock ${phase} timed out`)
  return milliseconds
}

// The helper handles both new nonblocking FIFOs and older inherited blocking
// descriptors. Only the status reader is inherited: never prolong the lease.
const STATUS_READER = `
const fs = require('fs')
const byte = Buffer.alloc(1)
const pause = new Int32Array(new SharedArrayBuffer(4))
let line = ''
for (;;) {
  let count
  try { count = fs.readSync(3, byte, 0, 1, null) }
  catch (error) {
    if (!['EAGAIN', 'EWOULDBLOCK', 'EINTR'].includes(error.code)) process.exit(3)
    Atomics.wait(pause, 0, 0, 10)
    continue
  }
  if (!count) {
    // Before acquisition the holder may not have opened its status writer yet.
    if (process.argv[1] !== 'acquisition' || line) process.exit(2)
    Atomics.wait(pause, 0, 0, 10)
    continue
  }
  line += String.fromCharCode(byte[0])
  if (byte[0] === 10) {
    fs.writeSync(1, line)
    process.exit(0)
  }
  if (line.length > 3 || byte[0] < 48 || byte[0] > 57) process.exit(2)
}
`

const readStatus = (fd, deadline, phase) => {
  const result = spawnSync(process.execPath, ['-e', STATUS_READER, phase], {
    stdio: ['ignore', 'pipe', 'pipe', fd],
    encoding: 'utf8',
    timeout: remaining(deadline, phase),
    killSignal: 'SIGKILL',
    maxBuffer: 1024,
  })
  if (result.error?.code === 'ETIMEDOUT') {
    throw lockError('LOCK_TIMEOUT', `File lock ${phase} timed out`)
  }
  if (result.error || result.signal || (result.status !== 0 && result.status !== 2)) {
    throw lockError('LOCK_FAILED', `Could not read file lock ${phase} status: ${result.error?.message || result.signal || result.status}`)
  }
  if (result.status !== 0 || !/^[0-9]{1,3}\n$/.test(result.stdout) || Number(result.stdout) > 255) {
    throw lockError('LOCK_PROTOCOL', `Invalid or incomplete file lock ${phase} status`)
  }
  return Number(result.stdout)
}

const openWriter = (file, deadline) => {
  for (;;) {
    remaining(deadline, 'acquisition')
    try { return fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK) }
    catch (error) {
      if (!['ENXIO', 'EINTR'].includes(error.code)) throw error
      Atomics.wait(pause, 0, 0, Math.min(10, remaining(deadline, 'acquisition')))
    }
  }
}

// The writer is a lease, not the lock itself. Passing both descriptors to a
// daemon keeps the holder alive and lets the last owner await actual release.
const fromDescriptors = (fd, statusFd, pipes = null) => {
  let released = false
  return {
    fd,
    statusFd,
    pipes,
    release: ({ wait = true } = {}) => {
      if (released) return
      released = true
      let failure
      try {
        fs.closeSync(fd)
        if (wait) {
          const code = readStatus(statusFd, now() + RELEASE_TIMEOUT, 'release')
          if (code !== 0) throw lockError('LOCK_FAILED', `File lock holder exited with status ${code} during release`)
        }
      } catch (error) {
        failure = error
      } finally {
        try { fs.closeSync(statusFd) } catch (error) { failure ||= error }
      }
      if (failure) throw failure
    },
  }
}

// Named pipes let another local process own the same lease without sending FDs.
const fromPipes = (pipes) => {
  if (!pipes || typeof pipes.control !== 'string' || typeof pipes.status !== 'string') {
    throw new Error('Invalid file lock lease')
  }
  for (const file of [pipes.control, pipes.status]) {
    const stat = fs.lstatSync(file)
    if (!stat.isFIFO() || (process.getuid && stat.uid !== process.getuid())) {
      throw new Error('Invalid file lock pipe')
    }
  }
  const fd = fs.openSync(pipes.control, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK)
  try {
    const statusFd = fs.openSync(pipes.status, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK)
    return fromDescriptors(fd, statusFd, pipes)
  } catch (error) {
    try { fs.closeSync(fd) } catch {}
    throw error
  }
}

const acquire = (file, { nonblock = false, timeout = 1000, shareable = false } = {}) => {
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 2147483647 - HANDSHAKE_TIMEOUT) {
    throw new RangeError('File lock timeout must be a positive integer within the supported timer range')
  }
  const deadline = now() + HANDSHAKE_TIMEOUT + (nonblock ? 0 : timeout)
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
  let acquired = false
  try {
    const fifo = spawnSync('mkfifo', ['-m', '600', control, status], {
      encoding: 'utf8', timeout: remaining(deadline, 'acquisition'), killSignal: 'SIGKILL',
    })
    if (fifo.error?.code === 'ETIMEDOUT') throw lockError('LOCK_TIMEOUT', 'File lock acquisition timed out')
    if (fifo.error || fifo.status !== 0) throw fifo.error || new Error(fifo.stderr.trim() || 'Could not create lock pipes')
    errorFd = fs.openSync(errorFile, 'w', 0o600)
    statusFd = fs.openSync(status, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK)
    child = spawn('/bin/sh', [HOLDER, control, status, path.resolve(file), ...(nonblock ? ['-n'] : ['-t', String(timeout)])], {
      detached: true,
      stdio: ['ignore', 'ignore', errorFd],
    })
    child.on('error', () => {})
    child.unref()
    if (!child.pid) throw new Error('Could not start file lock holder')
    fd = openWriter(control, deadline)
    const code = readStatus(statusFd, deadline, 'acquisition')
    if (code !== 0) {
      const detail = fs.readFileSync(errorFile, 'utf8').trim()
      throw Object.assign(new Error(detail || `s6-setlock exited with status ${code}`), { code: code === 1 ? 'LOCK_BUSY' : 'LOCK_FAILED' })
    }
    acquired = true
    fs.closeSync(errorFd)
    errorFd = undefined
    if (!shareable) fs.rmSync(dir, { recursive: true, force: true })
    return fromDescriptors(fd, statusFd, shareable ? { control, status } : null)
  } catch (err) {
    for (const descriptor of [fd, statusFd, errorFd]) {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor) } catch {}
      }
    }
    // No lease has escaped this failed call. Never signal shareable holders.
    if (!shareable && child?.pid) {
      try { process.kill(-child.pid, 'SIGKILL') } catch {}
    }
    if (!shareable || !acquired) {
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
    }
    throw err
  }
}

module.exports = { acquire, fromDescriptors, fromPipes }
