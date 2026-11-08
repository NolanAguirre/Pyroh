const { bucketKey } = require('./time')
const { runKeyOf, countBy, sortedCounts, round, percentile } = require('./stats')
const { splitUsage, sumUsage, usageTotal } = require('./usage')
const { summarizeWorkspaces } = require('./workspaces')
const { summarizeTargets } = require('./targets')

const READ_ONLY_MODES = ['plan', 'ask']

const groupKeyOf = (by) => (call) => {
  if (by === 'workspace') return call.workspaceName || call.workspaceId || '(none)'
  if (by === 'provider') return call.provider || '(none)'
  if (by === 'model') return call.model || '(default)'
  return call.sessionId
}

const summarizeTools = (calls) => {
  const toolRuns = new Map()
  for (const call of calls) {
    if (!toolRuns.has(call.name)) toolRuns.set(call.name, { count: 0, runs: new Set() })
    const entry = toolRuns.get(call.name)
    entry.count += 1
    entry.runs.add(runKeyOf(call))
  }
  return [...toolRuns.entries()]
    .map(([tool, entry]) => ({
      tool,
      count: entry.count,
      pct: calls.length ? round((entry.count / calls.length) * 100, 1) : 0,
      runs: entry.runs.size,
      perRun: round(entry.count / entry.runs.size),
    }))
    .sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool))
}

const summarizeOverTime = (calls, byTool, { bucket, top }) => {
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
  return {
    bucket,
    tools: topTools,
    hasOther: byTool.length > topTools.length,
    rows: [...buckets.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)),
  }
}

const summarizePerRun = (calls, { top, usageRuns }) => {
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
        model: call.model,
        step: call.step,
        mode: call.mode,
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
    if (tokenRuns.has(key)) {
      const existing = tokenRuns.get(key)
      existing.tokens = tokens
      if (!existing.model) existing.model = run.model
    } else tokenRuns.set(key, { ...run, usage: undefined, count: 0, tokens })
  }
  const tokenRunList = [...tokenRuns.values()]
  const byWorkspace = summarizeWorkspaces(tokenRunList)
  const modelGroups = new Map()
  for (const run of tokenRunList) {
    const model = run.model || '(default)'
    if (!modelGroups.has(model)) modelGroups.set(model, [])
    modelGroups.get(model).push(run.tokens)
  }
  const tokensByModel = [...modelGroups.entries()]
    .map(([model, parts]) => ({ model, tokens: sumUsage(parts) }))
    .sort((a, b) => usageTotal(b.tokens) - usageTotal(a.tokens) || a.model.localeCompare(b.model))
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
    tokensByModel,
    buildTokens: sumUsage(tokenRunList.filter((run) => !READ_ONLY_MODES.includes(run.mode)).map((run) => run.tokens)),
    top: runList.sort((a, b) => b.count - a.count).slice(0, top),
  }
  return { byWorkspace, perRun }
}

// Custom children are harness_agents spawns. Forks are copies, not nested work.
// Workflows are nested, but they are not custom subagents.
const isCustomSubagent = (run) => run.childKind === 'delegation'
  || (Boolean(run.parentRunId) && run.childKind !== 'workflow' && run.childKind !== 'fork')

const summarizeModes = (usageRuns) => {
  const unique = [...new Map((usageRuns || []).map((run) => [runKeyOf(run), run])).values()]
  const groups = new Map()
  for (const run of unique) {
    const mode = run.mode || '(none)'
    if (!groups.has(mode)) groups.set(mode, { mode, runs: 0, subagent: 0, nonNested: 0 })
    const entry = groups.get(mode)
    entry.runs += 1
    if (isCustomSubagent(run)) entry.subagent += 1
    else if (!run.parentRunId) entry.nonNested += 1
  }
  const modes = [...groups.values()].sort((a, b) => b.runs - a.runs || a.mode.localeCompare(b.mode))
  const sum = (key) => modes.reduce((total, entry) => total + entry[key], 0)
  return { runs: sum('runs'), subagent: sum('subagent'), nonNested: sum('nonNested'), modes }
}

const summarizeSubagents = (calls, usageRuns = []) => {
  const unique = [...new Map((usageRuns || []).map(run => [runKeyOf(run), run])).values()]
  const children = unique.filter(run => run.parentRunId)
  const parents = unique.filter(run => !run.parentRunId)
  const tokens = (runs) => sumUsage(runs.map(run => splitUsage(run.usage)))
  const harness = {
    count: new Set(children.map(run => run.sessionId)).size,
    outcomes: sortedCounts(countBy(children, run => run.status || 'unknown'), 'status'),
    durationMs: children.reduce((sum, run) => sum + (run.durationMs || 0), 0),
    directUsage: tokens(parents), childUsage: tokens(children), combinedUsage: tokens(unique),
    runs: children,
    byModel: [...new Set(children.map(run => JSON.stringify([run.provider, run.model])))].map(key => {
      const [provider, model] = JSON.parse(key)
      const runs = children.filter(run => run.provider === provider && run.model === model)
      return { provider, model, count: runs.length, durationMs: runs.reduce((sum, run) => sum + (run.durationMs || 0), 0), usage: tokens(runs) }
    }),
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
  return {
    harness,
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
}

const summarizeBreakdown = (calls, { by, top }) => {
  const keyOf = groupKeyOf(by)
  const groups = new Map()
  for (const call of calls) {
    const key = keyOf(call)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(call)
  }
  return {
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

// usageRuns (from loadRuns) adds token usage for runs without tool calls.
const summarize = (calls, { bucket = 'day', by = null, top = 10, since = null, until = null, tool = null, usageRuns = null } = {}) => {
  const runKeys = new Set(calls.map(runKeyOf))
  const sessionIds = new Set(calls.map((call) => call.sessionId))
  const byTool = summarizeTools(calls)
  const { byWorkspace, perRun } = summarizePerRun(calls, { top, usageRuns })

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
    overTime: summarizeOverTime(calls, byTool, { bucket, top }),
    perRun,
    byMode: summarizeModes(usageRuns),
    subagents: summarizeSubagents(calls, usageRuns),
    breakdown: by ? summarizeBreakdown(calls, { by, top }) : null,
    targets: tool ? summarizeTargets(calls, tool) : null,
  }
}

module.exports = { summarize }
