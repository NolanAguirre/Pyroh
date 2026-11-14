const fs = require('fs')
const path = require('path')
const { readJson } = require('./jsonFile')

// Read-only port of harness run/usage readers. Preserve raw fields and strict reads.
const jsonRecords = (dir) => {
  let names
  try {
    names = fs.readdirSync(dir)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
  return names.filter(name => name.endsWith('.json')).map(name => {
    const file = path.join(dir, name)
    return { file, record: readJson(file, null) }
  })
}

const runRecords = (sessionId, dir) => {
  const directories = [path.join(dir, 'runs'), dir]
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    if (name.isDirectory() && /^phase-/.test(name.name)) directories.push(path.join(dir, name.name))
  }
  return directories.flatMap(jsonRecords).filter(({ record }) => record?.sessionId === sessionId && record.id && 'usage' in record)
}

// One entry per run: usage records win over the usage copied onto run records.
// Usage records whose run record was replaced fall back to the file's mtime.
const listRunUsage = (sessionId, dir) => {
  const entries = new Map(runRecords(sessionId, dir).map(({ record }) => [record.id, {
    runId: record.id, startedAt: record.startedAt, step: record.step ?? null, usage: record.usage, durationMs: record.durationMs,
  }]))
  for (const { file, record } of jsonRecords(path.join(dir, 'usage'))) {
    if (!record?.runId) continue
    const run = entries.get(record.runId)
    entries.set(record.runId, {
      runId: record.runId,
      startedAt: run?.startedAt ?? fs.statSync(file).mtimeMs,
      step: run?.step ?? null,
      usage: record.usage,
      durationMs: record.durationMs,
    })
  }
  return [...entries.values()]
}

module.exports = { jsonRecords, runRecords, listRunUsage }
