const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const config = require('../config')
const paths = require('../store/paths')
const { ensureDir } = require('../store/jsonFile')

const SERVICE_ROOT = path.resolve(__dirname, '..', '..')
const BIN = path.join(SERVICE_ROOT, 'bin', 'harness')
const RUN_WITH_ENV = path.join(SERVICE_ROOT, 'scripts', 'run-with-env-dir')

const resolveEnvDir = () =>
  process.env.HARNESS_ENV_DIR || path.join(SERVICE_ROOT, 'env-dir')

// Spawn a fully detached process that outlives the parent. stdio is ignored;
// the child is expected to manage its own log files.
const spawnDetached = (command, args, opts = {}) => {
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    ...opts,
  })
  child.once('error', (err) => {
    process.stderr.write(`harness daemon could not start: ${err.message}\n`)
  })
  child.unref()
  if (!child.pid) throw new Error('Harness daemon could not start')
  return child.pid
}

// Spawn the harness CLI via run-with-env-dir so env-dir/default plus the
// $USER overlay (CURSOR_API_KEY, etc.) load in the child even if the parent
// was started before those files existed.
const spawnHarness = (cliArgs, opts = {}) => {
  // Redirect before exec: env loading and CLI imports can fail before attachLog.
  const file = paths.daemonLog(cliArgs[1], config.writeDir)
  ensureDir(path.dirname(file))
  const fd = fs.openSync(file, 'a', 0o600)
  try {
    fs.writeSync(fd, `[${new Date().toISOString()}] launching ${cliArgs.join(' ')}\n`)
    const stdio = [...(opts.stdio || ['ignore', 'ignore', 'ignore'])]
    stdio[1] = fd
    stdio[2] = fd
    return spawnDetached(RUN_WITH_ENV, [resolveEnvDir(), process.execPath, BIN, ...cliArgs], {
      cwd: SERVICE_ROOT,
      ...opts,
      stdio,
      env: { ...process.env, ...opts.env, HARNESS_LOG_FILE: file },
    })
  } finally {
    fs.closeSync(fd)
  }
}

const isAlive = (pid) => {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}

const signal = (pid, sig = 'SIGTERM') => {
  if (!pid) return false
  try {
    process.kill(pid, sig)
    return true
  } catch {
    return false
  }
}

module.exports = { spawnDetached, spawnHarness, isAlive, signal }
