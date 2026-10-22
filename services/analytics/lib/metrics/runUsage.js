const { listRunUsageAsync, normalizeUsage } = require('../source/usage')

const TOKEN_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'total']

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null)

const compute = async (session) => {
  const entries = await listRunUsageAsync(session.id, session.sessionDir)
  const runs = entries.map((entry) => ({
    runId: entry.runId,
    startedAt: Number.isFinite(entry.startedAt) ? entry.startedAt : null,
    step: entry.step == null ? null : String(entry.step),
    mode: entry.mode == null ? null : String(entry.mode),
    durationMs: Number.isFinite(entry.durationMs) ? Math.round(entry.durationMs) : null,
    usage: normalizeUsage(entry.usage, session.provider),
  }))
  const tokens = Object.fromEntries(TOKEN_KEYS.map((key) => [key, 0]))
  for (const run of runs) {
    if (run.usage) for (const key of TOKEN_KEYS) tokens[key] += Number(run.usage[key]) || 0
  }
  return {
    runs,
    totals: {
      runs: runs.length,
      withUsage: runs.filter((run) => run.usage).length,
      durationMs: runs.reduce((sum, run) => sum + (run.durationMs || 0), 0),
      tokens,
    },
  }
}

const column = (runs, pick) => runs.map(pick)
const usageColumn = (runs, key) => column(runs, (run) => (run.usage ? Math.round(Number(run.usage[key]) || 0) : null))

const store = async (client, session, result) => {
  await client.query('DELETE FROM runs WHERE session_id = $1', [session.id])
  const { runs } = result
  if (!runs.length) return
  await client.query(
    `INSERT INTO runs (session_id, run_id, started_at, step, mode, duration_ms, input, output, cache_read, cache_write, reasoning, total)
     SELECT $1, * FROM unnest($2::text[], $3::timestamptz[], $4::text[], $5::text[], $6::bigint[], $7::bigint[], $8::bigint[],
                              $9::bigint[], $10::bigint[], $11::bigint[], $12::bigint[])`,
    [
      session.id,
      column(runs, (run) => run.runId),
      column(runs, (run) => iso(run.startedAt)),
      column(runs, (run) => run.step),
      column(runs, (run) => run.mode),
      column(runs, (run) => run.durationMs),
      ...TOKEN_KEYS.map((key) => usageColumn(runs, key)),
    ],
  )
}

const summary = (result) => result.totals

module.exports = { name: 'run-usage', version: 2, compute, store, summary }
