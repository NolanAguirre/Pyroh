const fs = require('fs')
const path = require('path')
const { readJson } = require('./jsonFile')

// Read-only port of harness run index readers, including legacy index precedence.
const readEntries = (dir) => {
  let names
  try {
    names = fs.readdirSync(dir)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
  return names.filter(name => name.endsWith('.json'))
    .map(name => readJson(path.join(dir, name)))
    .filter(Boolean)
}

const listRuns = (writeDir, { mode } = {}) => {
  // Keep entries written before the index covered every mode discoverable.
  const entries = new Map(readEntries(path.join(writeDir, 'token-waste-runs'))
    .map(entry => [entry.runId, { ...entry, mode: 'token-waste' }]))
  for (const entry of readEntries(path.join(writeDir, 'run-index'))) entries.set(entry.runId, entry)
  return [...entries.values()]
    .filter(entry => !mode || entry.mode === mode)
    .sort((a, b) => b.startedAt - a.startedAt || a.runId.localeCompare(b.runId))
}

module.exports = { listRuns }
