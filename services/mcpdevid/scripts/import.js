const fs = require('fs')
const os = require('os')
const path = require('path')
const { importIds } = require('../lib/store')

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

const main = () => {
  const repos = process.argv.slice(2)
  if (!repos.length) {
    console.error('usage: node scripts/import.js <repoDir> [repoDir...]')
    process.exit(1)
  }
  repos.forEach((raw) => {
    const repoDir = path.resolve(expandHome(raw))
    const ids = findIds(repoDir)
    const added = importIds(ids, repoDir)
    console.log(`${repoDir}: found ${ids.length}, new ${added}`)
  })
}

main()
