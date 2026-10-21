const db = require('../db')
const { toList, invalid, sessionClauses, whereSql } = require('../filters')

// Tool-call stats over the tool_calls and runs fact tables. The output of
// summarize matches what the harness computed from events.jsonl directly.

const BUCKETS = ['hour', 'day', 'week']
const GROUPS = ['workspace', 'provider', 'model', 'session']
const UNITS = { m: 60e3, h: 3600e3, d: 86400e3, w: 7 * 86400e3 }
const TARGET_LIMIT = 200

const parseTime = (value, now = Date.now()) => {
  if (value === undefined || value === null || value === '') return null
  const text = String(value).trim()
  const relative = /^(\d+(?:\.\d+)?)([mhdw])$/.exec(text)
  if (relative) return now - Number(relative[1]) * UNITS[relative[2]]
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T00:00:00`).getTime()
    : Date.parse(text)
  if (Number.isNaN(ms)) throw new Error(`invalid time: ${value}`)
  return ms
}

const pad2 = (n) => String(n).padStart(2, '0')

const localDate = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`

const bucketKey = (ts, bucket) => {
  const date = new Date(ts)
  if (bucket === 'hour') return `${localDate(date)} ${pad2(date.getHours())}:00`
  if (bucket === 'week') {
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7))
    return localDate(monday)
  }
  return localDate(date)
}

const runKeyOf = (call) => `${call.sessionId}\0${call.runId || ''}`

const countBy = (items, keyOf) => {
  const counts = new Map()
  for (const item of items) {
    const key = keyOf(item)
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return counts
}

const sortedCounts = (counts, keyName) =>
  [...counts.entries()]
    .map(([key, count]) => ({ [keyName]: key, count }))
    .sort((a, b) => b.count - a.count || String(a[keyName]).localeCompare(String(b[keyName])))

const round = (n, places = 2) => Math.round(n * 10 ** places) / 10 ** places

const percentile = (sorted, p) => {
  if (!sorted.length) return 0
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]
}

const pairShare = (cache, fresh) => {
  const total = cache + fresh
  const cachePct = total ? round((cache / total) * 100, 1) : 0
  return {
    cache,
    fresh,
    cachePct,
    freshPct: total ? round(100 - cachePct, 1) : 0,
  }
}

// Stored input already includes cache reads and cache writes when they fit
// inside it. New reads are that remainder. New writes are output tokens.
const splitUsage = (usage) => {
  if (!usage) return null
  const input = usage.input || 0
  const output = usage.output || 0
  const cacheRead = usage.cacheRead || 0
  const cacheWrite = usage.cacheWrite || 0
  const cacheInside = cacheRead + cacheWrite <= input
  const newRead = cacheInside ? input - cacheRead - cacheWrite : input
  return {
    input,
    output,
    reads: pairShare(cacheRead, newRead),
    writes: pairShare(cacheWrite, output),
    inputPerOutput: output ? round(input / output, 2) : null,
  }
}

const sumUsage = (parts) => {
  const known = parts.filter(Boolean)
  const input = known.reduce((sum, part) => sum + part.input, 0)
  const output = known.reduce((sum, part) => sum + part.output, 0)
  const cacheRead = known.reduce((sum, part) => sum + part.reads.cache, 0)
  const newRead = known.reduce((sum, part) => sum + part.reads.fresh, 0)
  const cacheWrite = known.reduce((sum, part) => sum + part.writes.cache, 0)
  const newWrite = known.reduce((sum, part) => sum + part.writes.fresh, 0)
  return {
    runs: known.length,
    input,
    output,
    reads: pairShare(cacheRead, newRead),
    writes: pairShare(cacheWrite, newWrite),
    inputPerOutput: output ? round(input / output, 2) : null,
  }
}

const usageTotal = (tokens) =>
  tokens.reads.cache + tokens.reads.fresh + tokens.writes.cache + tokens.writes.fresh

const summarizeWorkspaces = (runList) => {
  const groups = new Map()
  for (const run of runList) {
    const key = run.workspaceId || ''
    if (!groups.has(key)) {
      groups.set(key, {
        workspaceId: run.workspaceId || null,
        workspaceName: run.workspaceName || null,
        sessions: new Set(),
        runs: [],
      })
    }
    const entry = groups.get(key)
    entry.sessions.add(run.sessionId)
    entry.runs.push(run)
  }
  return [...groups.values()]
    .map((entry) => {
      const tokens = sumUsage(entry.runs.map((run) => run.tokens))
      return {
        workspaceId: entry.workspaceId,
        workspaceName: entry.workspaceName,
        sessions: entry.sessions.size,
        runs: entry.runs.length,
        calls: entry.runs.reduce((sum, run) => sum + run.count, 0),
        tokens: { ...tokens, total: usageTotal(tokens) },
      }
    })
    .sort((a, b) => b.tokens.total - a.tokens.total || b.runs - a.runs)
}

// Calls grouped by target. repeats: calls that hit a target already hit in
// the same run. exactRepeats: calls whose full input already ran in the same
// run. variants: distinct full inputs seen for the target.
const summarizeTargets = (calls, tool) => {
  const groups = new Map()
  for (const call of calls) {
    if (!groups.has(call.target)) {
      groups.set(call.target, {
        key: call.target,
        kind: call.targetKind,
        count: 0,
        runs: new Set(),
        sessions: new Map(),
        signatures: new Set(),
        runSignatures: new Set(),
        lastTs: null,
      })
    }
    const entry = groups.get(call.target)
    const runKey = runKeyOf(call)
    const runSignature = `${runKey}\0${call.signature}`
    if (!entry.sessions.has(call.sessionId)) {
      entry.sessions.set(call.sessionId, {
        sessionId: call.sessionId,
        sessionName: call.sessionName,
        workspaceId: call.workspaceId,
        workspaceName: call.workspaceName,
        provider: call.provider,
        count: 0,
        runs: new Set(),
        signatures: new Set(),
        exactRepeats: 0,
        lastTs: null,
      })
    }
    const session = entry.sessions.get(call.sessionId)
    if (entry.runSignatures.has(runSignature)) session.exactRepeats += 1
    entry.count += 1
    entry.runs.add(runKey)
    entry.signatures.add(call.signature)
    entry.runSignatures.add(runSignature)
    if (!entry.lastTs || call.ts > entry.lastTs) entry.lastTs = call.ts
    session.count += 1
    session.runs.add(runKey)
    session.signatures.add(call.signature)
    if (!session.lastTs || call.ts > session.lastTs) session.lastTs = call.ts
  }
  const rows = [...groups.values()]
    .map((entry) => ({
      key: entry.key,
      kind: entry.kind,
      count: entry.count,
      runs: entry.runs.size,
      sessions: entry.sessions.size,
      repeats: entry.count - entry.runs.size,
      exactRepeats: entry.count - entry.runSignatures.size,
      variants: entry.signatures.size,
      lastTs: entry.lastTs,
      sessionCalls: [...entry.sessions.values()]
        .map((session) => ({
          sessionId: session.sessionId,
          sessionName: session.sessionName,
          workspaceId: session.workspaceId,
          workspaceName: session.workspaceName,
          provider: session.provider,
          count: session.count,
          runs: session.runs.size,
          repeats: session.count - session.runs.size,
          exactRepeats: session.exactRepeats,
          variants: session.signatures.size,
          lastTs: session.lastTs,
        }))
        .sort((a, b) => b.count - a.count || b.lastTs - a.lastTs),
    }))
    .sort((a, b) => b.count - a.count || b.repeats - a.repeats || a.key.localeCompare(b.key))
  return {
    tool,
    distinct: rows.length,
    calls: calls.length,
    repeats: rows.reduce((sum, row) => sum + row.repeats, 0),
    exactRepeats: rows.reduce((sum, row) => sum + row.exactRepeats, 0),
    truncated: rows.length > TARGET_LIMIT,
    rows: rows.slice(0, TARGET_LIMIT),
  }
}

const groupKeyOf = (by) => (call) => {
  if (by === 'workspace') return call.workspaceName || call.workspaceId || '(none)'
  if (by === 'provider') return call.provider || '(none)'
  if (by === 'model') return call.model || '(default)'
  return call.sessionId
}

// usageRuns (from loadRuns) adds token usage for runs without tool calls.
const summarize = (calls, { bucket = 'day', by = null, top = 10, since = null, until = null, tool = null, usageRuns = null } = {}) => {
  const runKeys = new Set(calls.map(runKeyOf))
  const sessionIds = new Set(calls.map((call) => call.sessionId))

  const toolRuns = new Map()
  for (const call of calls) {
    if (!toolRuns.has(call.name)) toolRuns.set(call.name, { count: 0, runs: new Set() })
    const entry = toolRuns.get(call.name)
    entry.count += 1
    entry.runs.add(runKeyOf(call))
  }
  const byTool = [...toolRuns.entries()]
    .map(([tool, entry]) => ({
      tool,
      count: entry.count,
      pct: calls.length ? round((entry.count / calls.length) * 100, 1) : 0,
      runs: entry.runs.size,
      perRun: round(entry.count / entry.runs.size),
    }))
    .sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool))

  const topTools = byTool.slice(0, top).map((entry) => entry.tool)
  const buckets = new Map()
  for (const call of calls) {
    const key = bucketKey(call.ts, bucket)
    if (!buckets.has(key)) buckets.set(key, { bucket: key, total: 0, other: 0, counts: {} })
    const row = buckets.get(key)
    row.total += 1
    if (topTools.includes(call.name)) row.counts[call.name] = (row.counts[call.name] || 0) + 1
    else row.other += 1
  }
  const overTime = {
    bucket,
    tools: topTools,
    hasOther: byTool.length > topTools.length,
    rows: [...buckets.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)),
  }

  const runs = new Map()
  for (const call of calls) {
    const key = runKeyOf(call)
    if (!runs.has(key)) {
      runs.set(key, {
        runId: call.runId,
        sessionId: call.sessionId,
        workspaceId: call.workspaceId,
        workspaceName: call.workspaceName,
        provider: call.provider,
        step: call.step,
        firstTs: call.ts,
        count: 0,
        tokens: splitUsage(call.usage),
      })
    }
    runs.get(key).count += 1
  }
  const runList = [...runs.values()]
  const tokenRuns = new Map(runList.map((run) => [runKeyOf(run), run]))
  for (const run of usageRuns || []) {
    const key = runKeyOf(run)
    const tokens = splitUsage(run.usage)
    if (tokenRuns.has(key)) tokenRuns.get(key).tokens = tokens
    else tokenRuns.set(key, { ...run, usage: undefined, count: 0, tokens })
  }
  const tokenRunList = [...tokenRuns.values()]
  const byWorkspace = summarizeWorkspaces(tokenRunList)
  const runCounts = runList.map((run) => run.count).sort((a, b) => a - b)
  const perRun = {
    runs: runCounts.length,
    mean: runCounts.length ? round(calls.length / runCounts.length) : 0,
    median: runCounts.length
      ? (runCounts.length % 2
        ? runCounts[(runCounts.length - 1) / 2]
        : (runCounts[runCounts.length / 2 - 1] + runCounts[runCounts.length / 2]) / 2)
      : 0,
    p90: percentile(runCounts, 0.9),
    max: runCounts.length ? runCounts[runCounts.length - 1] : 0,
    tokens: sumUsage(tokenRunList.map((run) => run.tokens)),
    top: runList.sort((a, b) => b.count - a.count).slice(0, top),
  }

  const tasks = calls.filter((call) => call.name === 'task' || call.subagentType)
  const stepCalls = calls.filter((call) => call.step)
  const topLevel = calls.filter((call) => !call.step)
  const stepRuns = new Map()
  for (const call of stepCalls) {
    if (!stepRuns.has(call.step)) stepRuns.set(call.step, { count: 0, runs: new Set() })
    const entry = stepRuns.get(call.step)
    entry.count += 1
    entry.runs.add(runKeyOf(call))
  }
  const subagents = {
    tasks: {
      total: tasks.length,
      byType: sortedCounts(countBy(tasks, (call) => call.subagentType || '(unspecified)'), 'type'),
    },
    decompose: {
      steps: [...stepRuns.entries()]
        .map(([step, entry]) => ({ step, count: entry.count, runs: entry.runs.size }))
        .sort((a, b) => b.count - a.count),
      topLevel: { count: topLevel.length, runs: new Set(topLevel.map(runKeyOf)).size },
    },
  }

  let breakdown = null
  if (by) {
    const keyOf = groupKeyOf(by)
    const groups = new Map()
    for (const call of calls) {
      const key = keyOf(call)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(call)
    }
    breakdown = {
      by,
      groups: [...groups.entries()]
        .map(([key, items]) => ({
          key,
          count: items.length,
          runs: new Set(items.map(runKeyOf)).size,
          tools: sortedCounts(countBy(items, (call) => call.name), 'tool').slice(0, top),
        }))
        .sort((a, b) => b.count - a.count),
    }
  }

  return {
    range: { since, until },
    totals: {
      calls: calls.length,
      runs: runKeys.size,
      sessions: sessionIds.size,
      first: calls.length ? calls[0].ts : null,
      last: calls.length ? calls[calls.length - 1].ts : null,
    },
    byTool,
    byWorkspace,
    overTime,
    perRun,
    subagents,
    breakdown,
    targets: tool ? summarizeTargets(calls, tool) : null,
  }
}

const parseOptions = (raw = {}, now = Date.now()) => {
  let since
  let until
  try {
    since = parseTime(raw.since, now)
    until = parseTime(raw.until, now)
  } catch (err) {
    throw invalid(err.message)
  }
  const bucket = raw.bucket || 'day'
  if (!BUCKETS.includes(bucket)) throw invalid(`bucket must be one of ${BUCKETS.join('|')}`)
  const by = raw.by || null
  if (by && !GROUPS.includes(by)) throw invalid(`by must be one of ${GROUPS.join('|')}`)
  const top = raw.top === undefined || raw.top === '' ? 10 : Number(raw.top)
  if (!Number.isInteger(top) || top < 1) throw invalid('top must be a positive integer')
  return {
    since,
    until,
    bucket,
    by,
    top,
    workspace: raw.workspace || raw.wid,
    session: raw.session,
    provider: raw.provider,
    tool: raw.tool,
  }
}


const num = (value) => (value === null || value === undefined ? null : Number(value))

const usageOf = (row) => (row.input === null || row.input === undefined ? null : {
  input: num(row.input),
  output: num(row.output),
  cacheRead: num(row.cache_read),
  cacheWrite: num(row.cache_write),
  reasoning: num(row.reasoning),
  total: num(row.total),
})

const tsClauses = (column, { since, until }, params) => {
  const clauses = []
  if (since != null) {
    params.push(since)
    clauses.push(`(${column} IS NULL OR ${column} >= to_timestamp($${params.length}::float8 / 1000))`)
  }
  if (until != null) {
    params.push(until)
    clauses.push(`(${column} IS NULL OR ${column} <= to_timestamp($${params.length}::float8 / 1000))`)
  }
  return clauses
}

const epochMs = (column) => `round(extract(epoch FROM ${column}) * 1000)::float8`

// Calls in the in-memory shape summarize expects, oldest first.
const loadCalls = async (options) => {
  const params = []
  const clauses = [...sessionClauses(options, params), ...tsClauses('c.ts', options, params)]
  const tools = toList(options.tool)
  if (tools) {
    params.push(tools)
    clauses.push(`c.name = ANY($${params.length}::text[])`)
  }
  const { rows } = await db.query(
    `SELECT c.session_id, c.run_id, ${epochMs('c.ts')} AS ts, c.name, c.subagent_type, c.phase, c.step,
            c.target_kind, c.target, c.signature,
            s.name AS session_name, s.workspace_id, w.name AS workspace_name, s.provider, s.model,
            r.input, r.output, r.cache_read, r.cache_write, r.reasoning, r.total
     FROM tool_calls c
     JOIN sessions s ON s.id = c.session_id
     LEFT JOIN workspaces w ON w.id = s.workspace_id
     LEFT JOIN runs r ON r.session_id = c.session_id AND r.run_id = c.run_id
     ${whereSql(clauses)}
     ORDER BY c.ts NULLS FIRST, c.session_id, c.call_key`,
    params,
  )
  return rows.map((row) => ({
    ts: row.ts,
    runId: row.run_id,
    sessionId: row.session_id,
    sessionName: row.session_name,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    provider: row.provider,
    model: row.model,
    phase: row.phase,
    step: row.step,
    name: row.name,
    subagentType: row.subagent_type,
    usage: usageOf(row),
    targetKind: row.target_kind,
    target: row.target,
    signature: row.signature,
  }))
}

// Every run with recorded usage, including runs that made no tool calls.
const loadRuns = async (options) => {
  const params = []
  const clauses = [
    ...sessionClauses(options, params),
    ...tsClauses('r.started_at', options, params),
    'r.input IS NOT NULL',
  ]
  const { rows } = await db.query(
    `SELECT r.session_id, r.run_id, ${epochMs('r.started_at')} AS started_at, r.step,
            r.input, r.output, r.cache_read, r.cache_write, r.reasoning, r.total,
            s.workspace_id, w.name AS workspace_name, s.provider
     FROM runs r
     JOIN sessions s ON s.id = r.session_id
     LEFT JOIN workspaces w ON w.id = s.workspace_id
     ${whereSql(clauses)}
     ORDER BY s.updated_at DESC NULLS LAST, r.session_id, r.started_at NULLS FIRST, r.run_id`,
    params,
  )
  return rows.map((row) => ({
    runId: row.run_id,
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    provider: row.provider,
    step: row.step,
    firstTs: row.started_at,
    usage: usageOf(row),
  }))
}

const toolStats = async (options) => {
  const [calls, allUsageRuns] = await Promise.all([loadCalls(options), loadRuns(options)])
  const called = options.tool ? new Set(calls.map(runKeyOf)) : null
  const usageRuns = called ? allUsageRuns.filter((run) => called.has(runKeyOf(run))) : allUsageRuns
  return summarize(calls, { ...options, usageRuns })
}

module.exports = {
  BUCKETS,
  GROUPS,
  parseTime,
  parseOptions,
  summarize,
  summarizeTargets,
  summarizeWorkspaces,
  splitUsage,
  sumUsage,
  bucketKey,
  toolStats,
}
