const fs = require('fs')
const os = require('os')
const path = require('path')

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build'])
const EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx'])
const DEV_ID = /(?:devId|<DevScope[^>]*\bid)\s*=\s*["'`]([a-z0-9]{7})["'`]/g

const expandHome = (raw) => {
  if (raw === '~') return os.homedir()
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2))
  return raw
}

const walk = (dir, files = []) => {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, files)
    } else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) {
      files.push(full)
    }
  })
  return files
}

const findIds = (repoDir) => {
  const ids = new Set()
  walk(repoDir).forEach((file) => {
    const text = fs.readFileSync(file, 'utf8')
    Array.from(text.matchAll(DEV_ID), (match) => match[1]).forEach((id) => ids.add(id))
  })
  return Array.from(ids)
}

module.exports = { expandHome, findIds }
