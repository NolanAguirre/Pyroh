const fs = require('fs')
const path = require('path')
const config = require('../config')

// True when `target` is the base itself or nested within it.
const isInsideBase = (target) => {
  const rel = path.relative(config.workBase, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

// Resolve a requested work dir relative to the configured base. Anything that
// escapes the base throws. An empty/undefined request resolves to the base.
const resolveWorkDir = (requested) => {
  const raw = requested === undefined || requested === null ? '' : String(requested)
  const resolved = raw ? path.resolve(config.workBase, raw) : config.workBase
  if (!isInsideBase(resolved)) {
    throw new Error(`work dir escapes base path: ${raw}`)
  }
  return resolved
}

// List the immediate subdirectories of a work dir (default = base). Skips
// dotfiles and anything that resolves outside the base.
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

  const parent = target === config.workBase ? null : path.dirname(target)
  return {
    basePath: config.workBase,
    path: target,
    parent,
    entries,
  }
}

module.exports = {
  resolveWorkDir,
  listWorkDirs,
  isInsideBase,
}
