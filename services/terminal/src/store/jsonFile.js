const fs = require('fs')
const path = require('path')

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true })
}

const readJson = (file, fallback = null) => {
  try {
    const raw = fs.readFileSync(file, 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    if (err.code === 'ENOENT') return fallback
    throw err
  }
}

// Atomic write: serialize to a temp file in the same dir, then rename.
const writeJson = (file, data) => {
  const dir = path.dirname(file)
  ensureDir(dir)
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`)
  const fd = fs.openSync(tmp, 'w', 0o600)
  try {
    fs.writeFileSync(fd, `${JSON.stringify(data, null, 2)}\n`)
    fs.fsyncSync(fd)
  } finally { fs.closeSync(fd) }
  fs.renameSync(tmp, file)
  const directory = fs.openSync(dir, 'r')
  try { fs.fsyncSync(directory) } finally { fs.closeSync(directory) }
  return data
}

module.exports = { ensureDir, readJson, writeJson }
