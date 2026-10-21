const fs = require('fs')
const path = require('path')

// Ported from services/harness/src/store/sessionStore.js.

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

const readJson = async (file) => {
  try {
    return JSON.parse(await fs.promises.readFile(file, 'utf8'))
  } catch {
    return null
  }
}

const jsonRecords = async (dir) => {
  let names
  try { names = await fs.promises.readdir(dir) } catch (err) { if (err.code === 'ENOENT') return []; throw err }
  return Promise.all(names.filter(name => name.endsWith('.json')).map(async name => {
    const file = path.join(dir, name)
    return { file, record: await readJson(file) }
  }))
}

const runRecords = async (sessionId, sessionDir) => {
  const directories = [path.join(sessionDir, 'runs'), sessionDir]
  for (const name of await fs.promises.readdir(sessionDir, { withFileTypes: true })) {
    if (name.isDirectory() && /^phase-/.test(name.name)) directories.push(path.join(sessionDir, name.name))
  }
  return (await Promise.all(directories.map(jsonRecords))).flat()
    .filter(({ record }) => record?.sessionId === sessionId && record.id && 'usage' in record)
}

// One entry per run: usage records win over the usage copied onto run records.
// Usage records whose run record was replaced fall back to the file's mtime.
const listRunUsageAsync = async (sessionId, sessionDir) => {
  const [runs, usage] = await Promise.all([runRecords(sessionId, sessionDir), jsonRecords(path.join(sessionDir, 'usage'))])
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

module.exports = { normalizeUsage, listRunUsageAsync, readJson }
