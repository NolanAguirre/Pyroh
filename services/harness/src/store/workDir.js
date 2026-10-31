const fs = require('fs')
const os = require('os')
const path = require('path')
const config = require('../config')

const allowedRoot = path.resolve(os.homedir())

// True when `target` is the home dir itself or nested within it.
const isInsideBase = (target) => {
  const rel = path.relative(allowedRoot, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

// Resolve a requested work dir relative to the configured base. Anything that
// escapes the home dir throws. An empty/undefined request resolves to the base.
const resolveWorkDir = (requested) => {
  const raw = requested === undefined || requested === null ? '' : String(requested)
  const resolved = raw ? path.resolve(config.workBase, raw) : config.workBase
  if (!isInsideBase(resolved)) {
    throw new Error(`work dir escapes home dir: ${raw}`)
  }
  return resolved
}

// List the immediate subdirectories of a work dir (default = base). Skips
// dotfiles and anything that resolves outside the home dir.
const listWorkDirs = (requested) => {
  const target = resolveWorkDir(requested)
  const stats = fs.statSync(target)
  if (!stats.isDirectory()) {
    throw new Error(`not a directory: ${target}`)
  }
  const entries = fs
    .readdirSync(target, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => ({ name: entry.name, path: path.join(target, entry.name) }))
    .filter((entry) => isInsideBase(entry.path))
    .sort((a, b) => a.name.localeCompare(b.name))

  const parent = target === allowedRoot ? null : path.dirname(target)
  return {
    basePath: allowedRoot,
    path: target,
    parent,
    entries,
  }
}

// Move a workspace directory to a new path. Returns true when a folder was
// renamed. If the old path is already gone and the new one exists, the caller
// only needs to update the stored path, so this returns false.
const renameWorkDir = (from, to) => {
  const source = path.resolve(from)
  const target = path.resolve(to)
  if (!isInsideBase(source) || !isInsideBase(target)) {
    throw new Error(`work dir escapes home dir: ${target}`)
  }
  if (source === allowedRoot || target === allowedRoot) {
    throw new Error('cannot rename the home directory')
  }
  if (source === target) return false

  const sourceExists = fs.existsSync(source)
  const targetExists = fs.existsSync(target)
  if (sourceExists && targetExists) {
    if (fs.realpathSync(source) === fs.realpathSync(target)) return false
    throw new Error(`directory already exists: ${target}`)
  }
  if (!sourceExists && targetExists) {
    if (!fs.statSync(target).isDirectory()) throw new Error(`not a directory: ${target}`)
    return false
  }
  if (!sourceExists) throw new Error(`directory not found: ${source}`)
  if (!fs.statSync(source).isDirectory()) throw new Error(`not a directory: ${source}`)

  const parent = path.dirname(target)
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new Error(`parent directory not found: ${parent}`)
  }

  const intoSelf = path.relative(fs.realpathSync(source), target)
  if (intoSelf === '' || (!intoSelf.startsWith('..') && !path.isAbsolute(intoSelf))) {
    throw new Error('cannot move a directory into itself')
  }

  try {
    fs.renameSync(source, target)
  } catch (err) {
    if (err.code === 'EXDEV') throw new Error('cannot move a directory onto another drive')
    throw err
  }
  return true
}

module.exports = {
  resolveWorkDir,
  listWorkDirs,
  isInsideBase,
  renameWorkDir,
}
