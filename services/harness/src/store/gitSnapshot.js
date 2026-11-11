const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const fileLock = require('./fileLock')

const HARNESS_GIT_NAME = 'harness'
const HARNESS_GIT_EMAIL = 'harness@localhost'
const SNAPSHOT_TIMEOUT_MS = 60000

// True only when `cwd` itself is a git work tree (has a `.git` dir or file).
// Nested paths inside some parent repo do not count.
const isGitRepo = (cwd) => {
  if (!cwd) return false
  try {
    const st = fs.lstatSync(path.join(cwd, '.git'))
    return st.isDirectory() || st.isFile()
  } catch {
    return false
  }
}

const gitEnv = () => {
  const env = { ...process.env }
  env.GIT_AUTHOR_NAME = HARNESS_GIT_NAME
  env.GIT_AUTHOR_EMAIL = HARNESS_GIT_EMAIL
  env.GIT_COMMITTER_NAME = HARNESS_GIT_NAME
  env.GIT_COMMITTER_EMAIL = HARNESS_GIT_EMAIL
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_ASKPASS = 'echo'
  env.GIT_EDITOR = 'true'
  env.GIT_CONFIG_GLOBAL = '/dev/null'
  env.GIT_CONFIG_SYSTEM = '/dev/null'
  env.GIT_CONFIG_NOSYSTEM = '1'
  return env
}

const gitConfigArgs = () => [
  '-c', `user.name=${HARNESS_GIT_NAME}`,
  '-c', `user.email=${HARNESS_GIT_EMAIL}`,
  '-c', 'commit.gpgsign=false',
  '-c', 'advice.detachedHead=false',
]

const runGit = (cwd, args) => {
  const result = spawnSync('git', ['-C', cwd, ...gitConfigArgs(), ...args], {
    env: gitEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: SNAPSHOT_TIMEOUT_MS,
  })
  if (result.error) {
    const detail = result.error.code === 'ETIMEDOUT'
      ? `timed out after ${SNAPSHOT_TIMEOUT_MS / 1000} seconds`
      : result.error.message
    throw new Error(`git ${args.join(' ')} failed: ${detail}`)
  }
  return result
}

const failGit = (args, result) => {
  const stderr = (result.stderr || '').trim()
  const stdout = (result.stdout || '').trim()
  const detail = stderr || stdout || `exit ${result.status}`
  throw new Error(`git ${args.join(' ')} failed: ${detail}`)
}

// If `cwd` is a git repo, stage everything and commit. No-op when the tree is
// already clean or `cwd` is not a repo. Throws if git operations fail.
const snapshotUnlocked = (cwd, { message, onProgress = () => {} } = {}) => {
  if (!isGitRepo(cwd)) return { committed: false, reason: 'not-a-repo' }

  onProgress(`git snapshot: staging changes in ${cwd}`)
  const add = runGit(cwd, ['add', '--all'])
  if (add.status !== 0) failGit(['add', '--all'], add)

  onProgress('git snapshot: checking staged changes')
  const diff = runGit(cwd, ['diff', '--cached', '--quiet'])
  if (diff.status === 0) return { committed: false, reason: 'clean' }
  if (diff.status !== 1) failGit(['diff', '--cached', '--quiet'], diff)

  const msg = message || 'harness: snapshot before agent run'
  onProgress('git snapshot: committing staged changes')
  const commit = runGit(cwd, ['commit', '--quiet', '--message', msg])
  if (commit.status !== 0) failGit(['commit'], commit)

  const rev = runGit(cwd, ['rev-parse', 'HEAD'])
  if (rev.status !== 0) failGit(['rev-parse', 'HEAD'], rev)

  return { committed: true, hash: (rev.stdout || '').trim() }
}

// Sessions sharing a checkout may run concurrently. Serialize only Git's
// staging/commit transaction, never the agent runs themselves.
const snapshotIfGitRepo = (cwd, options = {}) => {
  if (!isGitRepo(cwd)) return { committed: false, reason: 'not-a-repo' }
  const result = runGit(cwd, ['rev-parse', '--git-path', 'harness-snapshot.lock'])
  if (result.status !== 0) failGit(['rev-parse'], result)
  options.onProgress?.(`git snapshot: waiting for the workspace lock in ${cwd}`)
  let lock
  try {
    lock = fileLock.acquire(path.resolve(cwd, result.stdout.trim()), { timeout: SNAPSHOT_TIMEOUT_MS })
  } catch (cause) {
    const detail = cause.code === 'LOCK_BUSY' ? 'timed out waiting for another snapshot' : cause.message
    throw new Error(`Could not lock the workspace Git snapshot: ${detail}`)
  }
  try {
    return snapshotUnlocked(cwd, options)
  } finally { lock.release() }
}

module.exports = { snapshotIfGitRepo, isGitRepo }
