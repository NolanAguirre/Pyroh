const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { resolveRoot } = require('./workspaceRoot')

const MAX_BUFFER = 64 * 1024 * 1024
const MAX_DIFF_BYTES = 2 * 1024 * 1024
const DEFAULT_TIMEOUT = 30 * 1000
const NETWORK_TIMEOUT = 5 * 60 * 1000
const LOG_LIMIT = 50

const httpError = (httpStatus, message) => Object.assign(new Error(message), { httpStatus })

// GIT_EDITOR/GIT_TERMINAL_PROMPT keep commit and push from hanging on prompts
// that nobody can answer through the API.
const GIT_ENV = {
  ...process.env,
  GIT_EDITOR: 'true',
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
}

const run = (cwd, args, { timeout = DEFAULT_TIMEOUT, buffer = false } = {}) =>
  new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.quotepath=false', ...args], {
      cwd,
      env: GIT_ENV,
      timeout,
      maxBuffer: MAX_BUFFER,
      encoding: buffer ? 'buffer' : 'utf8',
    }, (err, stdout, stderr) => {
      if (!err) return resolve({ stdout, stderr: String(stderr) })
      const message = String(stderr || '').trim() || String(stdout || '').trim() || err.message
      reject(Object.assign(httpError(err.killed ? 504 : 400, message), { gitCode: err.code }))
    })
  })

const tryRun = async (cwd, args, options) => {
  try {
    return await run(cwd, args, options)
  } catch {
    return null
  }
}

const repoTop = async (workspace) => {
  const root = await resolveRoot(workspace)
  const found = await tryRun(root, ['rev-parse', '--show-toplevel'])
  if (!found) throw httpError(409, 'Not a git repository')
  return found.stdout.trim()
}

const isAbsent = (value) => value === undefined || value === null || value === ''

const checkPaths = (paths) => {
  if (isAbsent(paths)) return []
  if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string' || !p)) {
    throw httpError(400, 'paths must be an array of strings')
  }
  return paths
}

const checkRef = (name, label) => {
  if (typeof name !== 'string' || !name.trim()) throw httpError(400, `${label} is required`)
  if (name.startsWith('-')) throw httpError(400, `Invalid ${label}`)
  return name.trim()
}

const insideRepo = (top, rel) => {
  const full = path.resolve(top, rel)
  if (full !== top && !full.startsWith(top + path.sep)) throw httpError(400, 'Invalid path')
  return full
}

const hasHead = async (top) => Boolean(await tryRun(top, ['rev-parse', '--verify', '-q', 'HEAD']))

const statusOf = (xy) => ({
  index: xy[0] === '.' ? null : xy[0],
  worktree: xy[1] === '.' ? null : xy[1],
})

// Splits `count` space-separated fields off the front; the remainder is the
// path, which may itself contain spaces.
const fields = (line, count) => {
  const parts = []
  let rest = line
  for (let i = 0; i < count; i++) {
    const at = rest.indexOf(' ')
    parts.push(rest.slice(0, at))
    rest = rest.slice(at + 1)
  }
  return { parts, rest }
}

const parseStatus = (raw) => {
  const entries = raw.split('\0')
  const result = { branch: null, oid: null, upstream: null, ahead: 0, behind: 0, files: [] }
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (!entry) continue
    if (entry.startsWith('# branch.head ')) {
      const head = entry.slice('# branch.head '.length)
      result.branch = head === '(detached)' ? null : head
    } else if (entry.startsWith('# branch.oid ')) {
      const oid = entry.slice('# branch.oid '.length)
      result.oid = oid === '(initial)' ? null : oid
    } else if (entry.startsWith('# branch.upstream ')) {
      result.upstream = entry.slice('# branch.upstream '.length)
    } else if (entry.startsWith('# branch.ab ')) {
      const [ahead, behind] = entry.slice('# branch.ab '.length).split(' ')
      result.ahead = Math.abs(Number(ahead))
      result.behind = Math.abs(Number(behind))
    } else if (entry.startsWith('1 ')) {
      const { parts, rest } = fields(entry, 8)
      result.files.push({ path: rest, origPath: null, ...statusOf(parts[1]), untracked: false, conflicted: false })
    } else if (entry.startsWith('2 ')) {
      const { parts, rest } = fields(entry, 9)
      const origPath = entries[++i]
      result.files.push({ path: rest, origPath, ...statusOf(parts[1]), untracked: false, conflicted: false })
    } else if (entry.startsWith('u ')) {
      const { rest } = fields(entry, 10)
      result.files.push({ path: rest, origPath: null, index: 'U', worktree: 'U', untracked: false, conflicted: true })
    } else if (entry.startsWith('? ')) {
      result.files.push({ path: entry.slice(2), origPath: null, index: null, worktree: '?', untracked: true, conflicted: false })
    }
  }
  return result
}

const readStatus = async (top) => {
  const { stdout } = await run(top, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'])
  return parseStatus(stdout)
}

const status = async ({ workspace }) => {
  const top = await repoTop(workspace)
  const parsed = await readStatus(top)
  const remotes = await tryRun(top, ['remote'])
  return {
    root: top,
    ...parsed,
    detached: !parsed.branch,
    remotes: remotes ? remotes.stdout.split('\n').filter(Boolean) : [],
  }
}

const BRANCH_FORMAT = ['%(refname)', '%(refname:short)', '%(objectname:short)', '%(upstream:short)', '%(HEAD)', '%(committerdate:unix)', '%(contents:subject)'].join('%00')

const branches = async ({ workspace }) => {
  const top = await repoTop(workspace)
  const { stdout } = await run(top, ['for-each-ref', `--format=${BRANCH_FORMAT}`, '--sort=-committerdate', 'refs/heads', 'refs/remotes'])
  const rows = stdout.split('\n').filter(Boolean).map((line) => {
    const [ref, name, oid, upstream, head, date, subject] = line.split('\0')
    return { ref, name, oid, upstream: upstream || null, current: head === '*', date: Number(date) * 1000, subject }
  })
  return {
    current: (rows.find((row) => row.current) || {}).name || null,
    local: rows.filter((row) => row.ref.startsWith('refs/heads/')),
    remote: rows.filter((row) => row.ref.startsWith('refs/remotes/') && !row.ref.endsWith('/HEAD')),
  }
}

const checkout = async ({ workspace, branch, create, startPoint }) => {
  const top = await repoTop(workspace)
  const name = checkRef(branch, 'branch')
  const args = create ? ['switch', '-c', name] : ['switch', name]
  if (create && !isAbsent(startPoint)) args.push(checkRef(startPoint, 'start point'))
  await run(top, args)
  return status({ workspace })
}

const stage = async ({ workspace, paths }) => {
  const top = await repoTop(workspace)
  const list = checkPaths(paths)
  await run(top, list.length ? ['add', '-A', '--', ...list] : ['add', '-A'])
  return status({ workspace })
}

const unstage = async ({ workspace, paths }) => {
  const top = await repoTop(workspace)
  const list = checkPaths(paths)
  const targets = list.length ? list : ['.']
  if (await hasHead(top)) await run(top, ['restore', '--staged', '--', ...targets])
  else await run(top, ['rm', '--cached', '-r', '-q', '--', ...targets])
  return status({ workspace })
}

const discard = async ({ workspace, paths }) => {
  const top = await repoTop(workspace)
  const list = checkPaths(paths)
  if (!list.length) throw httpError(400, 'paths are required')
  const { files } = await readStatus(top)
  const untracked = new Set(files.filter((file) => file.untracked).map((file) => file.path))
  const toClean = list.filter((p) => untracked.has(p))
  const toRestore = list.filter((p) => !untracked.has(p))
  if (toRestore.length) await run(top, ['restore', '--worktree', '--', ...toRestore])
  if (toClean.length) await run(top, ['clean', '-f', '-q', '--', ...toClean])
  return status({ workspace })
}

const commit = async ({ workspace, message, amend }) => {
  const top = await repoTop(workspace)
  const text = typeof message === 'string' ? message.trim() : ''
  if (!text && !amend) throw httpError(400, 'Commit message is required')
  const args = ['commit']
  if (amend) args.push('--amend')
  if (text) args.push('-m', text)
  else args.push('--no-edit')
  const { stdout } = await run(top, args)
  return { output: stdout.trim(), status: await status({ workspace }) }
}

const pickRemote = (remotes) => (remotes.includes('origin') ? 'origin' : remotes[0])

const push = async ({ workspace, force }) => {
  const top = await repoTop(workspace)
  const current = await status({ workspace })
  if (!current.branch) throw httpError(409, 'Cannot push a detached HEAD')
  const args = ['push']
  if (force) args.push('--force-with-lease')
  if (!current.upstream) {
    const remote = pickRemote(current.remotes)
    if (!remote) throw httpError(409, 'No remote configured')
    args.push('-u', remote, current.branch)
  }
  const { stdout, stderr } = await run(top, args, { timeout: NETWORK_TIMEOUT })
  return { output: [stdout, stderr].join('\n').trim(), status: await status({ workspace }) }
}

const pull = async ({ workspace }) => {
  const top = await repoTop(workspace)
  const { stdout, stderr } = await run(top, ['pull', '--ff-only'], { timeout: NETWORK_TIMEOUT })
  return { output: [stdout, stderr].join('\n').trim(), status: await status({ workspace }) }
}

const rebase = async ({ workspace }) => {
  const top = await repoTop(workspace)
  const current = await readStatus(top)
  if (!current.branch) throw httpError(409, 'Cannot rebase a detached HEAD')
  if (!current.upstream) throw httpError(409, 'No upstream branch')
  const { stdout, stderr } = await run(top, ['pull', '--rebase'], { timeout: NETWORK_TIMEOUT })
  return { output: [stdout, stderr].join('\n').trim(), status: await status({ workspace }) }
}

const fetch = async ({ workspace }) => {
  const top = await repoTop(workspace)
  const { stdout, stderr } = await run(top, ['fetch', '--all', '--prune'], { timeout: NETWORK_TIMEOUT })
  return { output: [stdout, stderr].join('\n').trim(), status: await status({ workspace }) }
}

const showBlob = async (top, spec) => {
  const found = await tryRun(top, ['show', spec], { buffer: true })
  return found ? found.stdout : null
}

const readWorktree = async (top, rel) => {
  try {
    return await fs.promises.readFile(insideRepo(top, rel))
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') return null
    throw err
  }
}

const isBinary = (buf) => Boolean(buf) && buf.subarray(0, 8000).includes(0)

const readSides = async (top, rel, before, isStaged, rev) => {
  // Merge commits compare against the first parent; a root commit has no parent blob.
  if (rev) return [await showBlob(top, `${rev}^:${before}`), await showBlob(top, `${rev}:${rel}`)]
  if (isStaged) return [await showBlob(top, `HEAD:${before}`), await showBlob(top, `:${rel}`)]
  const original = (await showBlob(top, `:${rel}`)) ?? (await showBlob(top, `HEAD:${rel}`))
  return [original, await readWorktree(top, rel)]
}

const diff = async ({ workspace, path: rel, origPath, staged, commit: rev }) => {
  if (typeof rel !== 'string' || !rel) throw httpError(400, 'path is required')
  const top = await repoTop(workspace)
  insideRepo(top, rel)
  const before = isAbsent(origPath) ? rel : origPath
  const isStaged = staged === true || staged === 'true' || staged === '1'
  const commitRef = isAbsent(rev) ? null : checkRef(rev, 'commit')
  const [original, modified] = await readSides(top, rel, before, isStaged, commitRef)
  const size = Math.max(original ? original.length : 0, modified ? modified.length : 0)
  const base = { path: rel, origPath: before, staged: isStaged, commit: commitRef, added: original === null, deleted: modified === null }
  if (isBinary(original) || isBinary(modified)) return { ...base, binary: true, original: '', modified: '' }
  if (size > MAX_DIFF_BYTES) return { ...base, tooLarge: true, size, original: '', modified: '' }
  return {
    ...base,
    binary: false,
    original: original ? original.toString('utf8') : '',
    modified: modified ? modified.toString('utf8') : '',
  }
}

const LOG_FORMAT = ['%H', '%h', '%an', '%at', '%s'].join('%x00') + '%x1e'

const log = async ({ workspace, limit }) => {
  const top = await repoTop(workspace)
  if (!(await hasHead(top))) return { commits: [] }
  const count = Math.min(Math.max(Number(limit) || LOG_LIMIT, 1), 500)
  const { stdout } = await run(top, ['log', '-n', String(count), `--format=${LOG_FORMAT}`])
  const commits = stdout.split('\x1e').map((chunk) => chunk.trim()).filter(Boolean).map((chunk) => {
    const [hash, short, author, date, subject] = chunk.split('\0')
    return { hash, short, author, date: Number(date) * 1000, subject }
  })
  return { commits }
}

const COMMIT_FORMAT = ['%H', '%h', '%an', '%at', '%P', '%s', '%b'].join('%x00')

// diff-tree -z --name-status emits: status, path, and a second path for renames/copies.
const parseNameStatus = (raw) => {
  const entries = raw.split('\0').filter(Boolean)
  const files = []
  for (let i = 0; i < entries.length; i++) {
    const letter = entries[i][0]
    if (letter === 'R' || letter === 'C') {
      files.push({ status: letter, origPath: entries[i + 1], path: entries[i + 2] })
      i += 2
    } else {
      files.push({ status: letter, origPath: null, path: entries[i + 1] })
      i += 1
    }
  }
  return files
}

const commitFiles = async ({ workspace, commit: rev }) => {
  const top = await repoTop(workspace)
  const ref = checkRef(rev, 'commit')
  const { stdout: info } = await run(top, ['show', '-s', `--format=${COMMIT_FORMAT}`, ref])
  const [hash, short, author, date, parents, subject, body] = info.split('\0')
  const parentList = parents.split(' ').filter(Boolean)
  const range = parentList.length ? [parentList[0], hash] : ['--root', hash]
  const { stdout } = await run(top, ['diff-tree', '-r', '-z', '-M', '--no-commit-id', '--name-status', ...range])
  return {
    hash,
    short,
    author,
    date: Number(date) * 1000,
    parents: parentList,
    subject,
    body: (body || '').trim(),
    files: parseNameStatus(stdout),
  }
}

module.exports = { status, branches, checkout, stage, unstage, discard, commit, push, pull, rebase, fetch, diff, log, commitFiles }
