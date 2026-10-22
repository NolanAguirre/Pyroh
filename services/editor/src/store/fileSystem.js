const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const { resolveRoot } = require('./workspaceRoot')

const MAX_OPEN_BYTES = 5 * 1024 * 1024
const SNIFF_BYTES = 8192
const MEDIA_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'ico', 'jfif', 'apng',
  'mp4', 'webm', 'mov', 'm4v', 'ogv',
  'mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus',
])

const extensionOf = (name) => {
  const index = name.lastIndexOf('.')
  if (index <= 0) return ''
  return name.slice(index + 1).toLowerCase()
}

const isMediaName = (name) => MEDIA_EXTENSIONS.has(extensionOf(name))

const httpError = (httpStatus, message, extra) =>
  Object.assign(new Error(message), { httpStatus, extra })

const outsideRoot = () => httpError(403, 'Path is outside root')

const isInsideRoot = (target, root) => {
  if (target === root) return true
  const prefix = root === path.sep ? path.sep : root + path.sep
  return target.startsWith(prefix)
}

const assertInside = (target, root) => {
  if (!isInsideRoot(target, root)) throw outsideRoot()
  return target
}

const parseRel = (value, field) => {
  if (value === undefined || value === null) return []
  if (typeof value !== 'string') throw httpError(400, `${field} must be a string`)
  if (value.includes('\0')) throw httpError(400, `Invalid ${field}`)
  const segments = value.split('/').filter((segment) => segment !== '' && segment !== '.')
  if (segments.includes('..')) throw outsideRoot()
  return segments
}

const locate = (root, value, field = 'path') => {
  const segments = parseRel(value, field)
  return {
    root,
    segments,
    rel: segments.join('/'),
    name: segments.length ? segments[segments.length - 1] : '',
    lexical: assertInside(path.join(root, ...segments), root),
  }
}

const joinRel = (rel, name) => (rel ? `${rel}/${name}` : name)

const toEntry = (name, rel, stat) => ({
  name,
  path: rel,
  type: stat.isDirectory() ? 'dir' : 'file',
  size: stat.size,
  mtime: stat.mtimeMs,
})

const lstatOrNull = async (target) => {
  try {
    return await fs.promises.lstat(target)
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

// Requests stay rooted lexically; workspace symlinks may resolve outside the root.
const resolveExisting = async (loc) => fs.promises.realpath(loc.lexical)

// The entry itself (not a symlink's target), located under its real parent.
const resolveLink = async (loc) => {
  const parent = await fs.promises.realpath(path.join(loc.root, ...loc.segments.slice(0, -1)))
  const target = path.join(parent, loc.name)
  const stat = await fs.promises.lstat(target)
  return { target, stat }
}

// A possibly-absent path whose parent may be reached through a workspace symlink.
const resolveTarget = async (loc) => {
  if (!loc.segments.length) throw httpError(400, 'Path required')
  const parent = await fs.promises.realpath(path.join(loc.root, ...loc.segments.slice(0, -1)))
  const parentStat = await fs.promises.stat(parent)
  if (!parentStat.isDirectory()) throw httpError(400, 'Parent is not a directory')
  return path.join(parent, loc.name)
}

const listEntry = async (dir, loc, dirent) => {
  const full = path.join(dir, dirent.name)
  try {
    let stat
    if (dirent.isSymbolicLink()) {
      stat = await fs.promises.lstat(full)
      try {
        const real = await fs.promises.realpath(full)
        stat = await fs.promises.stat(real)
      } catch {
        // Keep broken or inaccessible links visible using the link's metadata.
      }
    } else if (dirent.isDirectory() || dirent.isFile()) {
      stat = await fs.promises.lstat(full)
    } else {
      return null
    }
    if (!dirent.isSymbolicLink() && !stat.isDirectory() && !stat.isFile()) return null
    if (dirent.name === '.git' && stat.isDirectory() && !dirent.isSymbolicLink()) return null
    return {
      ...toEntry(dirent.name, joinRel(loc.rel, dirent.name), stat),
      symlink: dirent.isSymbolicLink(),
    }
  } catch {
    return null
  }
}

const compareEntries = (a, b) => {
  if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
}

const listDir = async ({ workspace, path: value }) => {
  const root = await resolveRoot(workspace)
  const loc = locate(root, value)
  const dir = await resolveExisting(loc)
  const stat = await fs.promises.stat(dir)
  if (!stat.isDirectory()) throw httpError(400, 'Not a directory')
  const dirents = await fs.promises.readdir(dir, { withFileTypes: true })
  const entries = (await Promise.all(dirents.map((dirent) => listEntry(dir, loc, dirent))))
    .filter(Boolean)
    .sort(compareEntries)
  return { root, path: loc.rel, entries }
}

const readFile = async ({ workspace, path: value }) => {
  const loc = locate(await resolveRoot(workspace), value)
  const real = await resolveExisting(loc)
  const stat = await fs.promises.stat(real)
  if (!stat.isFile()) throw httpError(400, 'Not a file')
  const base = {
    path: loc.rel,
    name: loc.name,
    size: stat.size,
    mtime: stat.mtimeMs,
  }
  if (isMediaName(loc.name)) return { ...base, content: null, binary: true }
  if (stat.size > MAX_OPEN_BYTES) throw httpError(413, 'File too large to open')
  const buffer = await fs.promises.readFile(real)
  const binary = buffer.subarray(0, SNIFF_BYTES).includes(0)
  return {
    ...base,
    content: binary ? null : buffer.toString('utf8'),
    binary,
  }
}

const mediaPath = async ({ workspace, path: value }) => {
  const loc = locate(await resolveRoot(workspace), value)
  if (!isMediaName(loc.name)) throw httpError(400, 'Not a media file')
  const real = await resolveExisting(loc)
  const stat = await fs.promises.stat(real)
  if (!stat.isFile()) throw httpError(400, 'Not a file')
  return real
}

const writeFile = async ({ workspace, path: value, content, mtime }) => {
  if (typeof content !== 'string') throw httpError(400, 'content must be a string')
  if (mtime !== undefined && mtime !== null && !Number.isFinite(mtime)) {
    throw httpError(400, 'mtime must be a number')
  }
  const loc = locate(await resolveRoot(workspace), value)
  let target = await resolveTarget(loc)
  const existing = await lstatOrNull(target)
  if (existing) {
    if (existing.isSymbolicLink()) {
      try {
        target = await fs.promises.realpath(target)
      } catch (err) {
        if (err.code === 'ENOENT') throw httpError(400, 'Broken symlink')
        throw err
      }
    }
    const stat = await fs.promises.stat(target)
    if (!stat.isFile()) throw httpError(400, 'Not a file')
    if (typeof mtime === 'number' && Math.abs(stat.mtimeMs - mtime) >= 1) {
      throw httpError(409, 'File changed on disk', { mtime: stat.mtimeMs })
    }
  }
  await fs.promises.writeFile(target, content, 'utf8')
  const stat = await fs.promises.stat(target)
  return { path: loc.rel, size: stat.size, mtime: stat.mtimeMs }
}

const createFile = async ({ workspace, path: value }) => {
  const loc = locate(await resolveRoot(workspace), value)
  const target = await resolveTarget(loc)
  await fs.promises.writeFile(target, '', { flag: 'wx' })
  return toEntry(loc.name, loc.rel, await fs.promises.stat(target))
}

const createDir = async ({ workspace, path: value }) => {
  const loc = locate(await resolveRoot(workspace), value)
  const target = await resolveTarget(loc)
  await fs.promises.mkdir(target)
  return toEntry(loc.name, loc.rel, await fs.promises.stat(target))
}

const rename = async ({ workspace, from, to }) => {
  const root = await resolveRoot(workspace)
  const fromLoc = locate(root, from, 'from')
  const toLoc = locate(root, to, 'to')
  if (!fromLoc.segments.length) throw httpError(400, 'Cannot rename root')
  const source = await resolveLink(fromLoc)
  const target = await resolveTarget(toLoc)
  if (await lstatOrNull(target)) throw httpError(409, 'Already exists')
  await fs.promises.rename(source.target, target)
  return { from: fromLoc.rel, to: toLoc.rel }
}

const MAX_MATCHES = 200
const MAX_QUERY = 500

const rgText = (value) => (value && typeof value.text === 'string' ? value.text : '')

const clipMatch = (raw, column, length) => {
  const line = String(raw).replace(/\r?\n$/, '')
  const start = Math.max(0, column - 1)
  const windowStart = Math.max(0, start - 60)
  const windowEnd = Math.min(line.length, start + Math.max(length, 1) + 80)
  return {
    text: line.slice(windowStart, windowEnd),
    column: start - windowStart + 1,
    length: Math.max(length, 1),
  }
}

const relativeMatchPath = (root, value) => {
  if (!value || typeof value !== 'string' || value.includes('\0')) return null
  const abs = path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value)
  if (!isInsideRoot(abs, root)) return null
  const rel = abs === root ? '' : path.relative(root, abs).split(path.sep).join('/')
  if (!rel || rel.split('/').includes('..')) return null
  if (rel === 'node_modules' || rel.startsWith('node_modules/') || rel.includes('/node_modules/')) return null
  return rel
}

const runRg = (root, query) => new Promise((resolve, reject) => {
  const child = spawn('rg', [
    '--json',
    '-F',
    '-S',
    '--follow',
    '--glob', '!**/node_modules/**',
    '--glob', '!**/.git/**',
    '--max-filesize', '1M',
    '--max-count', '30',
    '-n',
    '--',
    query,
    '.',
  ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })

  const files = []
  const byPath = new Map()
  let pending = ''
  let stderr = ''
  let count = 0
  let truncated = false
  let settled = false

  const finish = (result) => {
    if (settled) return
    settled = true
    resolve(result)
  }

  const fail = (err) => {
    if (settled) return
    settled = true
    reject(err)
  }

  const take = (line) => {
    if (!line || truncated) return
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (!msg || msg.type !== 'match') return
    const data = msg.data || {}
    const rel = relativeMatchPath(root, rgText(data.path))
    if (!rel) return
    const sub = (data.submatches && data.submatches[0]) || {}
    const column = (sub.start || 0) + 1
    const length = Math.max((sub.end || column) - (sub.start || 0), 1)
    const clipped = clipMatch(rgText(data.lines), column, length)
    let file = byPath.get(rel)
    if (!file) {
      file = { path: rel, matches: [] }
      byPath.set(rel, file)
      files.push(file)
    }
    file.matches.push({
      line: data.line_number || 1,
      column,
      length,
      text: clipped.text,
      textColumn: clipped.column,
      textLength: clipped.length,
    })
    count += 1
    if (count >= MAX_MATCHES) {
      truncated = true
      child.kill()
    }
  }

  child.stdout.on('data', (chunk) => {
    pending += chunk
    const parts = pending.split('\n')
    pending = parts.pop()
    parts.forEach(take)
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  child.on('error', (err) => {
    if (err && err.code === 'ENOENT') fail(httpError(500, 'ripgrep (rg) is not installed'))
    else fail(err)
  })
  child.on('close', (code) => {
    if (pending) take(pending)
    if (settled) return
    if (code === 0 || code === 1 || truncated || code === null) finish({ query, truncated, files })
    else fail(httpError(500, stderr.trim() || 'Search failed'))
  })
})

const search = async ({ workspace, query }) => {
  if (query !== undefined && query !== null && typeof query !== 'string') {
    throw httpError(400, 'query must be a string')
  }
  const q = String(query || '').trim()
  if (!q) return { query: '', truncated: false, files: [] }
  if (q.length > MAX_QUERY) throw httpError(400, 'Query too long')
  return runRg(await resolveRoot(workspace), q)
}

const remove = async ({ workspace, path: value }) => {
  const loc = locate(await resolveRoot(workspace), value)
  if (!loc.segments.length) throw httpError(400, 'Cannot delete root')
  const { target } = await resolveLink(loc)
  await fs.promises.rm(target, { recursive: true, force: false })
}

module.exports = {
  isInsideRoot,
  resolveRoot,
  listDir,
  readFile,
  mediaPath,
  writeFile,
  createFile,
  createDir,
  rename,
  remove,
  search,
}
