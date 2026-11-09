const fs = require('fs')
const path = require('path')
const paths = require('../store/paths')
const store = require('../store/sessionStore')
const usageStore = require('../store/usageStore')
const runIndex = require('../store/runIndexStore')
const { readJson } = require('../store/jsonFile')
const { parseInputCommand } = require('../prompt/triggers')
const { createRequestMetrics, summarizeRequestMetrics } = require('../agents/requestMetrics')
const { createContextAnalysis } = require('./transcriptContext')

const fields = ['input', 'output', 'cacheRead', 'cacheWrite', 'fresh', 'reasoning', 'total', 'requests']
const number = (value) => Number.isSafeInteger(value) && value >= 0
const field = (object, names) => {
  for (const name of names) if (number(object?.[name])) return object[name]
  return null
}
const sum = (values) => values.every(value => value !== null)
  ? values.reduce((total, value) => total + value, 0) : null
const fmt = (value) => value === null || !Number.isFinite(value) ? 'unknown' : Math.round(value).toLocaleString('en-US')
const cell = (text) => String(text ?? '').replace(/[|\r\n]/g, ' ').replace(/`/g, '')

// Do not use normalizeUsage's missing-field zero defaults for coverage claims.
// These providers' adapters store inclusive input; Codex reasoning is in output.
const measuredUsage = (usage, provider) => {
  const input = field(usage, ['inputTokens', 'input_tokens', 'input'])
  const output = field(usage, ['outputTokens', 'output_tokens', 'output'])
  const cacheRead = field(usage, ['cacheReadTokens', 'cache_read_tokens', 'cacheRead'])
  const cacheWrite = field(usage, ['cacheWriteTokens', 'cache_write_tokens', 'cacheWrite'])
  const reasoning = field(usage, ['reasoningTokens', 'reasoning_tokens', 'reasoning'])
  const inclusiveInput = ['cursor', 'codex', 'claude'].includes(provider)
  // Fresh means input not served from cache. Cache creation is fresh input.
  const fresh = inclusiveInput && input !== null && cacheRead !== null && cacheRead <= input
    ? input - cacheRead : null
  const reportedTotal = field(usage, ['totalTokens', 'total_tokens', 'total'])
  const total = provider === 'cursor' ? sum([input, output])
    : reportedTotal ?? (['codex', 'claude'].includes(provider) ? sum([input, output]) : null)
  return { input, output, cacheRead, cacheWrite, fresh, reasoning, total }
}

const parseAssumptions = (text = '') => {
  const result = {}
  for (const part of text.trim().split(/\s+/).filter(Boolean)) {
    const match = /^(shared|requests|output)=(\d+)$/i.exec(part)
    const key = match?.[1].toLowerCase()
    const value = match ? Number(match[2]) : NaN
    if (!match || !number(value) || key in result || (key === 'requests' && value === 0)) {
      throw Object.assign(new Error('Use analyze subagent [shared=<tokens>] [requests=<positive count>] [output=<tokens>]. Supply each whole-number assumption once.'), { status: 400 })
    }
    result[key] = value
  }
  return result
}

const aggregate = (rows) => Object.fromEntries(fields.map(key => {
  const known = rows.filter(row => row[key] !== null)
  return [key, { value: known.length === rows.length ? sum(known.map(row => row[key])) : null,
    subtotal: known.reduce((total, row) => total + row[key], 0), covered: known.length, count: rows.length }]
}))
const metric = (value) => value.value !== null ? fmt(value.value)
  : `unknown (${fmt(value.subtotal)} known; ${value.covered}/${value.count} runs)`
const requestFields = (keys) => [
  ...(keys.includes('inputTokens') ? ['input'] : []),
  ...(keys.includes('cacheReadTokens') ? ['cacheRead'] : []),
  ...(keys.includes('inputTokens') && keys.includes('cacheReadTokens') ? ['fresh'] : []),
]

// Live summaries reconcile every send segment before reconciling the whole run.
// Repeated summaries replace by segment ID; they are never additive snapshots.
const requestEvidence = (events, usage, provider, saved, cutoff) => {
  const segments = new Map()
  const accept = (metrics) => {
    if (![1, 2].includes(metrics?.version) || metrics.provider !== provider || !metrics.segmentId
      || !number(metrics.updatedAt) || metrics.updatedAt > cutoff) return
    if ((segments.get(metrics.segmentId)?.updatedAt ?? -1) <= metrics.updatedAt) segments.set(metrics.segmentId, metrics)
  }
  for (const event of events) if (event.type === 'model_request_metrics') accept(event.metrics)
  if ([1, 2].includes(saved?.version) && number(saved.updatedAt) && saved.updatedAt <= cutoff) {
    for (const segment of saved.segments || []) accept(segment)
  }
  // A crash can leave raw evidence after the last summary. Recover those IDs
  // and timings as partial observations, never as a newly complete count.
  const raw = new Map()
  for (const event of events) {
    if (!['model_request', 'model_request_evidence'].includes(event.type) || ![1, 2].includes(event.version)
      || event.provider !== provider || !event.segmentId || event.parentToolUseId || event.nested) continue
    if (!raw.has(event.segmentId)) raw.set(event.segmentId, [])
    raw.get(event.segmentId).push(event)
  }
  for (const [segmentId, records] of raw) {
    const previous = segments.get(segmentId)
    if (previous && !records.some(record => record.ts > previous.updatedAt)) continue
    const collector = createRequestMetrics({ provider, segmentId, startedAt: previous?.startedAt ?? records[0].ts })
    for (const event of [...(previous?.requestRecords || []), ...(previous?.evidence || []), ...records]) collector.observe(event)
    segments.set(segmentId, { ...collector.snapshot(), endedAt: previous?.endedAt ?? null,
      status: previous?.status || 'unknown', updatedAt: Math.max(...records.map(record => record.ts)),
      reason: 'Raw evidence lacks a matching final coverage summary.' })
  }
  if (segments.size || events.some(event => ['model_request', 'model_request_evidence'].includes(event.type) && [1, 2].includes(event.version))) {
    const metrics = summarizeRequestMetrics([...segments.values()])
    const tokens = measuredUsage(metrics.coveredUsage, provider)
    const reconciled = metrics.coverage === 'complete' && usage.input !== null && usage.output !== null
      && tokens.input === usage.input && tokens.output === usage.output
    const matching = metrics.matchedFields.filter(key => {
      const name = { inputTokens: 'input', cacheReadTokens: 'cacheRead', cacheWriteTokens: 'cacheWrite',
        outputTokens: 'output', reasoningTokens: 'reasoning' }[key]
      return name && usage[name] !== null && tokens[name] === usage[name]
    })
    return { requests: reconciled ? metrics.requests : null,
      fields: reconciled ? requestFields(matching) : [],
      coverage: reconciled ? 'complete' : metrics.coverage === 'unsupported' ? 'unsupported' : 'partial',
      observed: metrics.observedRequests,
      segments: metrics.segments,
      detail: [...new Set([
        metrics.reason,
        ...metrics.segments.flatMap(segment => [segment.provenance, segment.limitation, segment.reason]),
        !reconciled && metrics.coverage === 'complete' && 'Segment totals do not reconcile with authoritative run usage.',
        !segments.size && 'Request snapshots exist without a final coverage summary.',
      ].filter(Boolean))].join(' ') }
  }

  // Historical direct response evidence retains the original reconciliation rule.
  // Usage-only history remains unknown.
  const requests = new Map()
  for (const event of events) {
    if (event.type !== 'model_request' || !event.requestId || event.provider !== provider || event.parentToolUseId || event.nested) continue
    requests.set(event.requestId, measuredUsage(event.usage, provider))
  }
  const rows = [...requests.values()]
  const matched = provider === 'claude' && requests.size > 0 && usage.input !== null && usage.output !== null
    && sum(rows.map(row => row.input)) === usage.input && sum(rows.map(row => row.output)) === usage.output
  const cacheMatched = usage.cacheRead !== null && sum(rows.map(row => row.cacheRead)) === usage.cacheRead
  return { requests: matched ? requests.size : null, fields: matched ? ['input', ...(cacheMatched ? ['cacheRead', 'fresh'] : [])] : [],
    coverage: matched ? 'legacy reconciled' : 'unknown', observed: requests.size || null,
    detail: matched ? 'Historical response IDs and latest usage reconcile; final streaming boundaries were not recorded.'
      : 'No complete direct request evidence; historical counts are unknown.' }
}

const collect = (current, writeDir, cutoff) => {
  const warnings = new Set()
  const read = (file) => {
    try { return readJson(file) } catch (err) { warnings.add(`Cannot read ${file}: ${err.message}`); return null }
  }
  let index = []
  try { index = runIndex.listRuns(writeDir) }
  catch (err) { warnings.add(`Run index unavailable: ${err.message}`) }
  // Read raw metadata: ancestry enrichment deliberately rejects cycles, while
  // this read-only report needs to describe and stop them without failing.
  const directories = (dir) => {
    try { return fs.readdirSync(dir, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => path.join(dir, item.name)) }
    catch (err) {
      if (err.code !== 'ENOENT') warnings.add(`Cannot discover sessions in ${dir}: ${err.message}`)
      return []
    }
  }
  const sessions = new Map()
  const roots = [paths.legacySessionsDir(writeDir), ...directories(paths.workspacesDir(writeDir)).map(dir => path.join(dir, 'sessions'))]
  for (const root of roots) for (const dir of directories(root)) {
    const session = read(path.join(dir, 'session.json'))
    if (session?.id) sessions.set(session.id, session)
  }
  sessions.set(current.id, current)
  const indexed = new Map()
  const hints = new Map()
  const hint = (id, file) => {
    if (!id || typeof file !== 'string' || !path.isAbsolute(file)) return
    if (!hints.has(id)) hints.set(id, new Set())
    hints.get(id).add(file)
  }
  for (const entry of index) {
    if (!indexed.has(entry.sessionId)) indexed.set(entry.sessionId, [])
    indexed.get(entry.sessionId).push(entry)
    hint(entry.sessionId, entry.sessionPath)
    hint(entry.sourceSessionId, entry.sourceSessionPath)
  }
  const locate = (id) => {
    const local = paths.locateSession(id, writeDir)
    if (local) return { session: sessions.get(id) || read(path.join(local.dir, 'session.json')), dir: local.dir }
    for (const file of hints.get(id) || []) {
      const session = read(file)
      if (session?.id === id) return { session, dir: path.dirname(file) }
    }
    const entry = indexed.get(id)?.[0]
    if (!entry) return null
    warnings.add(`Session metadata unavailable for ${id}; using indexed run locations.`)
    return { session: { ...entry, id }, dir: entry.sessionPath ? path.dirname(entry.sessionPath) : null }
  }

  let source = current
  const sources = new Set([source.id])
  while (source.sourceSessionId) {
    if (sources.has(source.sourceSessionId)) { warnings.add('Cycle in source-session links; stopped at the last distinct source.'); break }
    const next = locate(source.sourceSessionId)?.session
    if (!next) { warnings.add(`Source session ${source.sourceSessionId} is unlocated; using ${source.id}.`); break }
    sources.add(next.id)
    source = next
  }

  // Global metadata and the run index find descendants outside the source
  // directory. Explicit delegation links also reveal missing/unindexed children.
  const relations = new Map()
  const relation = (parent, child, parentRunId) => {
    if (!parent || !child) return
    if (!relations.has(parent)) relations.set(parent, [])
    relations.get(parent).push({ sessionId: child, parentRunId })
  }
  for (const session of sessions.values()) {
    if (session.childKind !== 'fork') relation(session.parentSessionId, session.id, session.parentRunId)
  }
  for (const entry of index) {
    if (sessions.get(entry.sessionId)?.childKind !== 'fork') relation(entry.parentSessionId, entry.sessionId, entry.parentRunId)
  }

  const agents = []
  const seen = new Set()
  const seenRuns = new Set()
  const pending = [{ id: source.id, ancestors: [], depth: 0 }]
  let excluded = 0
  while (pending.length) {
    const node = pending.pop()
    if (node.ancestors.includes(node.id)) { warnings.add(`Delegation cycle at ${node.id}; counted once.`); continue }
    if (seen.has(node.id)) continue
    seen.add(node.id)
    const location = locate(node.id)
    if (!location?.session) { warnings.add(`Linked child ${node.id} is unlocated; its usage is unknown.`); continue }
    const { session, dir } = location
    if (node.depth && session.childKind === 'fork') continue
    if (session.createdAt > cutoff) continue
    const records = new Map()
    for (const entry of indexed.get(node.id) || []) {
      const record = entry.runPath ? read(entry.runPath) : null
      records.set(entry.runId, { file: entry.runPath,
        record: record?.id === entry.runId && record?.sessionId === node.id ? record : { ...entry, id: entry.runId } })
    }
    let usage = new Map()
    if (dir) {
      try {
        for (const item of usageStore.runRecords(node.id, writeDir, dir)) records.set(item.record.id, item)
        usage = new Map(usageStore.listRunUsage(node.id, writeDir, dir).map(item => [item.runId, item]))
      } catch (err) { warnings.add(`Incomplete records for ${node.id}: ${err.message}`) }
    }
    for (const entry of usage.values()) {
      if (!records.has(entry.runId)) {
        records.set(entry.runId, { record: { ...entry, id: entry.runId } })
        warnings.add(`Run metadata missing for ${entry.runId}; completion coverage is unknown.`)
      }
    }
    if (node.expectedRunId && !records.has(node.expectedRunId)) {
      warnings.add(`Linked run ${node.expectedRunId} in ${node.id} is missing; its usage is unknown.`)
    }
    const events = new Map()
    if (dir) {
      try {
        for (const line of fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').split('\n')) {
          if (!line.trim()) continue
          let event
          try { event = JSON.parse(line) } catch { warnings.add(`Incomplete transcript lines in ${node.id}; request coverage may be missing.`); continue }
          if (!number(event.ts) || event.ts > cutoff || !['model_request', 'model_request_evidence', 'model_request_metrics'].includes(event.type)) continue
          if (!events.has(event.runId)) events.set(event.runId, [])
          events.get(event.runId).push(event)
        }
      } catch (err) {
        warnings.add(`Request transcript unavailable for ${node.id}: ${err.code || err.message}`)
      }
    }
    const rows = []
    const included = new Set()
    for (const { record, file } of records.values()) {
      if (record.startedAt > cutoff) continue
      if (node.depth && session.delegationDetached && !session.delegationDetached.runIds?.includes(record.id)) {
        warnings.add(`Excluded work after delegation ended in ${node.id}.`)
        continue
      }
      let local = Boolean(record.localCommand)
      if (!local && file && record.mode === 'agent') {
        try { local = Boolean(parseInputCommand(store.readRecordPrompt(record, file))) }
        catch { /* Missing prompts do not invalidate reported usage. */ }
      }
      if (local) { excluded += 1; continue }
      const key = `${node.id}:${record.id}`
      if (seenRuns.has(key)) continue
      seenRuns.add(key)
      included.add(record.id)
      // Workflow controller runs are containers, not additive model usage.
      if (record.workflow) { excluded += 1; continue }
      const complete = number(record.endedAt) && record.endedAt <= cutoff
      const provider = record.provider || session.provider
      const reported = usage.has(record.id) ? usage.get(record.id).usage : record.usage
      const tokens = measuredUsage(complete ? reported : null, provider)
      if (!complete) warnings.add(`Run ${record.id} was ongoing or lacked a completion timestamp at cutoff; usage is unknown.`)
      const evidence = requestEvidence(events.get(record.id) || [], tokens, provider, record.modelRequests, cutoff)
      rows.push({ ...tokens, requests: complete ? evidence.requests : null, requestFields: evidence.fields, requestEvidence: evidence,
        id: record.id, sessionId: node.id, provider, model: record.model || session.model || 'unknown',
        startedAt: record.startedAt, endedAt: complete ? record.endedAt : null, status: complete ? record.status || 'finished' : 'incomplete at cutoff' })
    }
    rows.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0) || a.id.localeCompare(b.id))
    agents.push({ id: node.id, depth: node.depth, session, rows })
    const links = [...(relations.get(node.id) || [])]
    for (const { record } of records.values()) {
      if (included.has(record.id)) for (const id of record.workflowChildren || []) links.push({ sessionId: id, parentRunId: record.id })
    }
    if (dir) {
      try {
        for (const { record: state } of usageStore.jsonRecords(path.join(dir, 'delegation'))) {
          if (!state || !included.has(state.runId)) continue
          for (const child of Object.values(state.children || {})) {
            if (child.createdAt > cutoff) continue
            if (!child.sessionId) { warnings.add(`Unlocated child spawn in ${state.runId}${child.error ? `: ${child.error}` : ''}; no usage available.`); continue }
            hint(child.sessionId, child.sessionPath)
            links.push({ ...child, parentRunId: state.runId })
          }
        }
      } catch (err) { warnings.add(`Delegation links unavailable for ${node.id}: ${err.message}`) }
    }
    for (const link of links) {
      if (link.parentRunId && !included.has(link.parentRunId)) {
        if (records.has(link.parentRunId)) continue
        warnings.add(`Parent run ${link.parentRunId} for linked child ${link.sessionId} is missing; parent usage is unknown.`)
      }
      pending.push({ id: link.sessionId, expectedRunId: link.runId, depth: node.depth + 1, ancestors: [...node.ancestors, node.id] })
    }
  }
  const sourcesForContext = new Map([...sessions.values()].map(session => [session.id, locate(session.id)]))
  for (const agent of agents) sourcesForContext.set(agent.id, locate(agent.id))
  const context = createContextAnalysis([...sourcesForContext.values()].filter(Boolean), writeDir, cutoff)
  return { source, agents, warnings: [...warnings], excluded, cutoff, context }
}

// The counterfactual keeps coordinator work and child output constant. It is
// an input-token scenario, not evidence of quality, elapsed-time or cash savings.
const comparison = (data, assumptions, summaries) => {
  const children = data.agents.filter(agent => agent.depth > 0 && agent.rows.length)
  if (!children.length) return ['**Worth it?** No subagent work found.']
  const root = data.agents.find(agent => agent.depth === 0)
  const parentContext = root ? summaries.get(root.id).current : null
  const childRows = children.flatMap(agent => agent.rows)
  const totals = aggregate(childRows)
  const stats = children.map(agent => summaries.get(agent.id))
  const turns = assumptions.requests ?? sum(stats.map(stat => stat.turns))
  const shared = assumptions.shared ?? 0
  const output = assumptions.output ?? totals.output.value
  const mergedContext = parentContext !== null ? parentContext - shared : null
  const mergedInput = mergedContext !== null && mergedContext >= 0 && turns > 0 ? mergedContext * turns : null
  const available = !data.warnings.length && mergedInput !== null && output !== null && totals.total.value !== null
  const difference = available ? mergedInput + output - totals.total.value : null
  const lines = [difference === null
    ? '**Worth it?** Unclear: usage, turns, or context is missing.'
    : difference > 0
      ? `**Worth it?** The rough model favors subagents by about ${fmt(difference)} tokens.`
      : difference < 0
        ? `**Worth it?** The rough model favors doing the work in the coordinator by about ${fmt(-difference)} tokens.`
        : '**Worth it?** No token advantage in this model.']
  lines.push(`Subagents used ${metric(totals.total)} tokens across ${fmt(turns)}${assumptions.requests !== undefined ? ' assumed combined' : stats.some(stat => stat.turnsEstimated) ? ' estimated' : ''} model turns.`)
  if (available) {
    lines.push(`Why: at the coordinator’s current context, (${fmt(parentContext)} − ${fmt(shared)} shared deduction) × ${fmt(turns)} turns + ${fmt(output)} output ≈ ${fmt(mergedInput + output)} tokens for the child work. Existing coordinator work stays constant; future context growth is not modeled.`)
  } else {
    lines.push('The comparison needs known child usage, a current coordinator context, and measured or estimated child turns. Incomplete work or missing delegation records blocks a verdict.')
  }
  lines.push(`This assumes ${assumptions.requests === undefined ? 'the same number of turns' : 'your combined turn count'} and ${assumptions.output === undefined ? 'the same output' : 'your output estimate'}${assumptions.shared === undefined ? ', with no shared-context deduction (shared=0)' : ''}. It does not measure work quality, time saved, or dollar cost.`)
  return lines
}

const analyzeSubagents = (session, writeDir, assumptions = {}) => {
  const data = collect(session, writeDir, Date.now())
  const summaries = new Map(data.agents.map(agent => [agent.id, data.context.describe(agent)]))
  const estimate = (value, estimated) => `${estimated ? '~' : ''}${fmt(value)}`
  const lines = [
    '## Subagent analysis',
    '', ...comparison(data, assumptions, summaries).flatMap(line => [line, '']),
    '| Agent | Model turns | Current context | Input tokens |',
    '| --- | ---: | ---: | ---: |',
    ...data.agents.filter(agent => agent.rows.length).map(agent => {
      const summary = summaries.get(agent.id)
      const label = `${agent.depth ? 'Subagent' : 'Coordinator'} ${agent.session.name || agent.id} (${agent.session.provider || agent.rows[0].provider})`
      return `| ${cell(label)} | ${estimate(summary.turns, summary.turnsEstimated)} | ${estimate(summary.current, summary.currentEstimated)} | ${metric(aggregate(agent.rows).input)} |`
    }),
    '',
    '~ means estimated. Measured turns use reconciled model requests; tool calls are not turns.',
  ]
  if (data.agents.some(agent => agent.rows.some(row => row.provider === 'cursor'))) {
    lines.push('', `Cursor: current context ≈ transcript characters × average tokens/character from ${data.context.samples} GPT/Claude agents. Estimated turns ≈ input tokens ÷ average context, assuming even growth from the run’s starting context to its ending context. Observed response IDs provide a lower bound.`,
      'Calibration excludes known compaction, context resets, inherited history, incomplete data, and agents above 2M reported tokens. Hidden compaction and provider differences can still skew estimates.')
    const reasons = [...new Set(data.agents.filter(agent => agent.session.provider === 'cursor')
      .map(agent => summaries.get(agent.id).reason).filter(Boolean))]
    if (reasons.length) lines.push(`Unavailable estimates: ${reasons.map(cell).join(' ')}`)
  }
  if (data.warnings.length) lines.push('', `Coverage: ${data.warnings.slice(0, 2).map(cell).join(' ')}${data.warnings.length > 2 ? ` (${data.warnings.length - 2} more gaps.)` : ''}`)
  return lines.join('\n')
}

module.exports = { analyzeSubagents, parseAssumptions }
