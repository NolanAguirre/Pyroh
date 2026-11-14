const fs = require('fs')

// Read-only port of harness storage JSON reads, preserving parse errors.
const readJson = (file, fallback = null) => {
  try {
    const raw = fs.readFileSync(file, 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    if (err.code === 'ENOENT') return fallback
    throw err
  }
}

module.exports = { readJson }
