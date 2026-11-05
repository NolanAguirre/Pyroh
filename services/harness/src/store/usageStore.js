const fs = require('fs')
const path = require('path')
const paths = require('./paths')
const { readJson, readJsonAsync, writeJson } = require('./jsonFile')
const { emptyTotals, persistableSession, withResolvedCwd, writeSession, loadSession } = require('./sessionRecord')

// Cursor SDK inputTokens already include cache reads/writes, but its totalTokens
// adds them again, so the Cursor total is recomputed from input + output.
const normalizeUsage = (usage, provider) => {
  if (!usage) return null
  const input = usage.inputTokens ?? usage.input_tokens ?? usage.input ?? 0
  const output = usage.outputTokens ?? usage.output_tokens ?? usage.output ?? 0
  const cacheRead =
    usage.cacheReadTokens ?? usage.cache_read_tokens ?? usage.cacheRead ?? 0
  const cacheWrite =
    usage.cacheWriteTokens ?? usage.cache_write_tokens ?? usage.cacheWrite ?? 0
  const reasoning = usage.reasoningTokens ?? usage.reasoning_tokens ?? usage.reasoning ?? 0
  const total = provider === 'cursor' ? input + output
    : usage.totalTokens ?? usage.total_tokens ?? usage.total ?? input + output + reasoning
  return { input, output, cacheRead, cacheWrite, reasoning, total }
}

// Completion receipts and usage entries are keyed by run ID. Rebuilding totals
// is idempotent even if a process dies between saving usage and finalizing a run.
const usageDir = (sessionId, writeDir) => path.join(paths.sessionDir(sessionId, writeDir), 'usage')
const receiptDir = (sessionId, writeDir) => path.join(paths.sessionDir(sessionId, writeDir), 'receipts')

const jsonRecords = (dir) => {
  let names
  try { names = fs.readdirSync(dir) } catch (err) { if (err.code === 'ENOENT') return []; throw err }
  return names.filter(name => name.endsWith('.json')).map(name => {
    const file = path.join(dir, name)
    return { file, record: readJson(file, null) }
  })
}

const runRecords = (sessionId, writeDir, dir = paths.sessionDir(sessionId, writeDir)) => {
  const directories = [path.join(dir, 'runs'), dir]
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    if (name.isDirectory() && /^phase-/.test(name.name)) directories.push(path.join(dir, name.name))
  }
  return directories.flatMap(jsonRecords).filter(({ record }) => record?.sessionId === sessionId && record.id && 'usage' in record)
}

const jsonRecordsAsync = async (dir) => {
  let names
  try { names = await fs.promises.readdir(dir) } catch (err) { if (err.code === 'ENOENT') return []; throw err }
  return Promise.all(names.filter(name => name.endsWith('.json')).map(async name => {
    const file = path.join(dir, name)
    return { file, record: await readJsonAsync(file, null) }
  }))
}

const runRecordsAsync = async (sessionId, writeDir) => {
  const dir = paths.sessionDir(sessionId, writeDir)
  const directories = [paths.runsDir(sessionId, writeDir), dir]
  for (const name of await fs.promises.readdir(dir, { withFileTypes: true })) {
    if (name.isDirectory() && /^phase-/.test(name.name)) directories.push(path.join(dir, name.name))
  }
  return (await Promise.all(directories.map(jsonRecordsAsync))).flat()
    .filter(({ record }) => record?.sessionId === sessionId && record.id && 'usage' in record)
}

const totalsMatch = (left, right) => {
  if (!left || !right || left.durationMs !== right.durationMs) return false
  const a = left.tokens || {}
  const b = right.tokens || {}
  return Object.keys({ ...a, ...b }).every((key) => (a[key] || 0) === (b[key] || 0))
}

// One entry per run: usage records win over the usage copied onto run records.
// Usage records whose run record was replaced fall back to the file's mtime.
const listRunUsage = (sessionId, writeDir, dir = paths.sessionDir(sessionId, writeDir)) => {
  const entries = new Map(runRecords(sessionId, writeDir, dir).map(({ record }) => [record.id, {
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

const listRunUsageAsync = async (sessionId, writeDir) => {
  const [runs, usage] = await Promise.all([runRecordsAsync(sessionId, writeDir), jsonRecordsAsync(usageDir(sessionId, writeDir))])
  const entries = new Map(runs.map(({ record }) => [record.id, {
    runId: record.id, startedAt: record.startedAt, step: record.step ?? null, usage: record.usage, durationMs: record.durationMs,
  }]))
  for (const { file, record } of usage) {
    if (!record?.runId) continue
    const run = entries.get(record.runId)
    entries.set(record.runId, {
      runId: record.runId,
      startedAt: run?.startedAt ?? (await fs.promises.stat(file)).mtimeMs,
      step: run?.step ?? null,
      usage: record.usage,
      durationMs: record.durationMs,
    })
  }
  return [...entries.values()]
}

const rebuildTotals = (sessionId, writeDir) => {
  const entries = listRunUsage(sessionId, writeDir)
  const session = loadSession(sessionId, writeDir)
  if (!session) throw new Error(`session not found: ${sessionId}`)
  const totals = emptyTotals()
  for (const record of entries) {
    const usage = normalizeUsage(record.usage, session.provider)
    if (usage) for (const key of Object.keys(totals.tokens)) totals.tokens[key] += usage[key]
    totals.durationMs += record.durationMs || 0
  }
  if (totalsMatch(session.totals, totals)) return session
  const next = persistableSession({ ...session, totals })
  writeSession(next, writeDir)
  return withResolvedCwd(next, writeDir)
}

const addToTotals = (sessionId, { runId, usage, durationMs }, writeDir) => {
  if (!runId) throw new Error('Usage accounting requires a run ID')
  writeJson(path.join(usageDir(sessionId, writeDir), `${runId}.json`), { runId, usage, durationMs })
  return rebuildTotals(sessionId, writeDir)
}

module.exports = {
  normalizeUsage,
  usageDir,
  receiptDir,
  jsonRecords,
  runRecords,
  listRunUsage,
  listRunUsageAsync,
  rebuildTotals,
  addToTotals,
}
