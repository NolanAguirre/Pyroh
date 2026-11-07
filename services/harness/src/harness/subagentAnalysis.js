const fs = require('fs')
const path = require('path')
const paths = require('../store/paths')
const store = require('../store/sessionStore')
const usageStore = require('../store/usageStore')
const runIndex = require('../store/runIndexStore')
const { readJson } = require('../store/jsonFile')
const { parseInputCommand } = require('../prompt/triggers')
const { createRequestMetrics, summarizeRequestMetrics } = require('../agents/requestMetrics')
const { readEvidence: readCodexEvidence } = require('../agents/providers/codexTelemetry')

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
const average = (rows, key) => {
  const covered = rows.filter(row => row[key] !== null && row.requests !== null && row.requestFields?.includes(key))
  if (!rows.length || covered.length !== rows.length) return 'unknown'
  const requests = covered.reduce((total, row) => total + row.requests, 0)
  if (!requests) return 'unknown'
  const value = fmt(covered.reduce((total, row) => total + row[key], 0) / requests)
  return value
}

const requestFields = (keys) => [
  ...(keys.includes('inputTokens') ? ['input'] : []),
  ...(keys.includes('cacheReadTokens') ? ['cacheRead'] : []),
  ...(keys.includes('inputTokens') && keys.includes('cacheReadTokens') ? ['fresh'] : []),
]

// Live summaries reconcile every send segment before reconciling the whole run.
// Repeated summaries replace by segment ID; they are never additive snapshots.
const requestEvidence = (events, usage, provider, saved, cutoff, context) => {
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
    const telemetry = provider === 'codex' ? readCodexEvidence({ segments: metrics.segments, cutoff, ...context }) : null
    const telemetryRecords = telemetry ? [...telemetry.bySegment.values()].flat() : []
    const telemetryConfigured = metrics.segments.some(segment => segment.telemetryCaptures?.length)
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
      segments: metrics.segments.map(segment => ({ ...segment, telemetry: telemetry?.bySegment.get(segment.segmentId) || [] })),
      detail: [...new Set([
        metrics.reason,
        ...metrics.segments.flatMap(segment => [segment.provenance, segment.limitation, segment.reason]),
        !reconciled && metrics.coverage === 'complete' && 'Segment totals do not reconcile with authoritative run usage.',
        !segments.size && 'Request snapshots exist without a final coverage summary.',
        telemetryConfigured && `Codex telemetry: ${telemetryRecords.length} attributed log records (${telemetryRecords.filter(record => record.attribution === 'thread_and_time_window').length} by thread/time window); ${telemetry.unattributed} unattributed; ${telemetry.excluded} other-thread records excluded. Log records are not request counts; export completeness is unknown.`,
        provider === 'codex' && !telemetryConfigured && 'No local telemetry capture was configured for these segments.',
        ...(telemetry?.issues || []),
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
      const evidence = requestEvidence(events.get(record.id) || [], tokens, provider, record.modelRequests, cutoff,
        { writeDir, sessionId: node.id, runId: record.id })
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
  return { source, agents, warnings: [...warnings], excluded, cutoff }
}

const comparison = (agents, assumptions, warnings) => {
  const descendants = agents.filter(agent => agent.depth > 0 && agent.rows.length)
  const childRows = descendants.flatMap(agent => agent.rows)
  const children = aggregate(childRows)
  const root = aggregate(agents.filter(agent => agent.depth === 0).flatMap(agent => agent.rows))
  const complete = descendants.length > 0 && descendants.every(agent => {
    const totals = aggregate(agent.rows)
    return totals.input.value !== null && totals.requests.value > 0 && agent.rows.every(row => row.requestFields?.includes('input'))
  })
  const summedAverages = complete ? descendants.reduce((total, agent) => {
    const totals = aggregate(agent.rows)
    return total + totals.input.value / totals.requests.value
  }, 0) : null
  const requests = assumptions.requests ?? children.requests.value
  const output = assumptions.output ?? children.output.value
  const shared = assumptions.shared ?? null
  const avg = summedAverages !== null && shared !== null ? summedAverages - shared : null
  const estimatedInput = avg !== null && avg >= 0 && requests > 0 ? avg * requests : null
  // Any missing links or incomplete runs prevent a whole-subtree prediction.
  const available = estimatedInput !== null && output !== null && warnings.length === 0
  const lines = [
    '### Hypothetical combined agent — estimate, not measured',
    `Coordinator baseline: ${metric(root.total)} tokens. This is measured root work; delegation-only overhead cannot be isolated from it. This comparison holds all root/coordinator work constant; it does not claim delegation overhead disappears. Descendant coordinator work is included among the tasks being combined.`,
    `Measured descendant input: ${metric(children.input)}; output: ${metric(children.output)}; total: ${metric(children.total)}.`,
    'Rough model: merged average context ≈ sum of descendant average request contexts − shared starting-context deduction; merged input ≈ merged average × assumed combined requests. Output is estimated separately.',
    `Sum of descendant average contexts: ${fmt(summedAverages)}. Shared deduction: ${fmt(shared)}${shared !== null ? ' (user assumption)' : ' (not measured; supply shared=<tokens>)'}.`,
    `Combined requests: ${fmt(requests)} (${assumptions.requests !== undefined ? 'user assumption' : 'assumes the measured descendant request count stays constant, when known'}). Combined output: ${fmt(output)} (${assumptions.output !== undefined ? 'user assumption' : 'assumes measured descendant output stays constant, when known'}).`,
  ]
  if (available) {
    const estimate = estimatedInput + output
    lines.push(`Estimated merged average: ${fmt(avg)}; input: ${fmt(estimatedInput)}; output: ${fmt(output)}; descendant total: ${fmt(estimate)}; subtree total with constant coordinator: ${fmt(root.total.value === null ? null : root.total.value + estimate)}.`)
    if (children.total.value !== null) lines.push(`Estimated token difference versus measured descendants: ${fmt(estimate - children.total.value)} (positive means more tokens).`)
  } else {
    lines.push('Numeric merged estimate unavailable: it requires complete request and usage coverage, a supplied shared-context deduction, a positive combined request count, and a nonnegative merged context. Missing links or incomplete coverage also block a whole-subtree estimate.')
  }
  const breakEven = available && avg > 0 && children.total.value !== null && children.total.value >= output
    ? (children.total.value - output) / avg : null
  lines.push(`Token break-even request count: ${fmt(breakEven)} (rounded). Formula: (measured descendant total − assumed merged output) / merged average. This holds coordinator work constant and is not a price break-even.`)
  const intervals = descendants.map(agent => ({ id: agent.id,
    start: agent.rows.every(row => number(row.startedAt)) ? Math.min(...agent.rows.map(row => row.startedAt)) : null,
    end: agent.rows.every(row => number(row.endedAt)) ? Math.max(...agent.rows.map(row => row.endedAt)) : null,
  })).sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity))
  const timing = intervals.length > 1 && intervals.every(item => item.start !== null && item.end !== null)
  const overlap = timing && intervals.some((item, i) => intervals.slice(0, i).some(previous => previous.end > item.start))
  lines.push(timing
    ? `Observed start order: ${intervals.map(item => cell(item.id)).join(' → ')}. ${overlap ? 'Run intervals overlap; this does not establish model-request interleaving.' : 'Agent run intervals are sequential.'}`
    : 'Sequential versus interleaved request order is unknown from the available timing evidence.')
  if (available) {
    const half = Math.max(1, Math.ceil(requests / 2))
    lines.push(`Batching sensitivity with the same assumed context and output: ${fmt(half)} requests → ${fmt(avg * half + output)} descendant tokens; ${fmt(requests * 2)} requests → ${fmt(avg * requests * 2 + output)}. These are scenarios, not supported execution forecasts.`)
  }
  lines.push('Sequential task grouping and interleaving can change retained context, summaries, outputs, and request count; this simple model does not simulate those effects. Shared deduction must represent total duplicated starting context across the combined agents, not an invented prefix size.',
    'Cache reuse and fresh-token cost differ from total tokens. No cache hits, cost savings, latency savings, or exact per-file attribution are predicted.')
  return lines.join('\n\n')
}

const timestamp = value => number(value) && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : 'unknown'
const timeWindow = values => {
  const known = values.filter(number)
  return known.length ? `${timestamp(Math.min(...known))} → ${timestamp(Math.max(...known))}` : 'unknown'
}
const durations = values => {
  const known = values.filter(value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '')
    && Number.isFinite(Number(value)) && Number(value) >= 0).map(Number)
  return known.length ? `${known.length} records; ${fmt(Math.min(...known))}–${fmt(Math.max(...known))} ms` : 'unknown'
}

const analyzeSubagents = (session, writeDir, assumptions = {}) => {
  const data = collect(session, writeDir, Date.now())
  const rows = data.agents.flatMap(agent => agent.rows)
  const totals = aggregate(rows)
  const tableHeader = '| Agent / run | Input | Output | Cache read | Cache write | Fresh | Reasoning | Total | Model requests |'
  const tableRule = '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
  const tableRow = (label, values) => `| ${cell(label)} | ${fields.map(key => metric(values[key])).join(' | ')} |`
  const timingRows = rows.flatMap(row => (row.requestEvidence.segments || []).map(segment => {
    const localTimes = [...(segment.requestRecords || []).flatMap(record => [record.firstObservedAt, record.lastObservedAt]),
      ...(segment.evidence || []).map(record => record.observedAt)]
    const steps = (segment.evidence || []).filter(record => record.kind === 'step' && record.eventType === 'step-completed')
    return `| ${cell(`${row.id} / ${segment.segmentId}`)} | ${timestamp(segment.startedAt)} → ${timestamp(segment.endedAt)} | ${timeWindow(localTimes)} | ${durations(steps.map(record => record.durationMs))} | ${timeWindow((segment.telemetry || []).map(record => record.occurredAt))} | ${durations((segment.telemetry || []).map(record => record.attributes?.duration_ms))} |`
  }))
  const lines = [
    '## Subagent usage analysis',
    `Source: ${cell(data.source.id)}${data.source.id !== session.id ? ` (requested from ${cell(session.id)})` : ''}. Cutoff: ${new Date(data.cutoff).toISOString()}.`,
    `Measured coverage: ${data.agents.length} located agents, ${rows.length} model-run records; ${data.excluded} local commands or workflow containers excluded. This analysis itself makes no model requests and is excluded.`,
    'One authoritative usage record per run wins over its run copy. Session totals, child rollups, cumulative stream snapshots, and raw/result copies are not added. Finished records at cutoff are included; ongoing or missing data remain unknown. Reads occur across files, so this is not an atomic snapshot.',
    'Fresh = inclusive input − cache reads when provider semantics and both fields are established; cache writes are part of fresh input. Cache is within input and reasoning is within output where confirmed, never added again to total. Unknown is not zero. “Known” subtotals cover only located records.',
    '### Measured usage by agent',
    tableHeader, tableRule,
    ...data.agents.map(agent => tableRow(`${agent.depth ? `depth ${agent.depth}` : 'coordinator'} ${agent.id} (${agent.rows.length} runs)`, aggregate(agent.rows))),
    tableRow(data.warnings.length ? 'Located subtree (coverage gaps below)' : 'Whole subtree', totals),
    '', '### Measured usage by run', tableHeader, tableRule,
    ...data.agents.flatMap(agent => agent.rows.map(row => tableRow(`${agent.id} / ${row.id} · ${row.provider}/${row.model} · ${row.status}`, aggregate([row])))),
    '', '### Whole-token request averages',
    'Weighted by model requests and rounded to whole tokens. Average context = total input / model-request count. Every run in a displayed scope must have complete reconciled coverage for that average; partial observed IDs are never denominators. Tool calls, user turns, and run counts are never request counts.',
    '', '| Scope | Average request context | Average cached input | Average fresh input |', '| --- | ---: | ---: | ---: |',
    ...data.agents.map(agent => `| ${cell(agent.id)} | ${average(agent.rows, 'input')} | ${average(agent.rows, 'cacheRead')} | ${average(agent.rows, 'fresh')} |`),
    ...rows.map(row => `| ${cell(row.id)} | ${average([row], 'input')} | ${average([row], 'cacheRead')} | ${average([row], 'fresh')} |`),
    `| Located subtree | ${average(rows, 'input')} | ${average(rows, 'cacheRead')} | ${average(rows, 'fresh')} |`,
    '', 'Live request counts require unique completed response IDs, complete coverage of every steering segment, and input/output reconciliation with authoritative segment and run usage. Claude also checks reported model round trips when supplied. Cache/fresh averages require matching covered cache usage. Historical direct response evidence is labeled separately; usage-only history stays unknown.',
    '', '### Request evidence and limits',
    '| Run | Coverage | Observed model/response IDs (may be partial) | Provenance / limits |', '| --- | --- | ---: | --- |',
    ...rows.map(row => `| ${cell(row.id)} | ${cell(row.requestEvidence.coverage)} | ${fmt(row.requestEvidence.observed)} | ${cell(row.requestEvidence.detail)} |`),
    '', '### Recorded evidence timing',
    'Observation timestamps, conversation-step durations, and Codex transport/event durations are different measurements. Ranges describe only recorded evidence, not model-request latency or complete request order. Codex batches can arrive after run completion; only records received by the report cutoff are included. Unattributed and native child-thread events are excluded from the intervals below. Per-event values remain in the durable evidence records.',
    '| Run / steering segment | Segment interval | Local evidence observed | Cursor step durations | Codex event timestamps | Codex transport/event durations |',
    '| --- | --- | --- | --- | --- | --- |',
    ...(timingRows.length ? timingRows : ['| Historical records | unknown | unknown | unknown | unknown | unknown |']),
    '', comparison(data.agents, assumptions, data.warnings),
  ]
  if (data.warnings.length) lines.push('', '### Coverage gaps', '', ...data.warnings.map(warning => `- ${cell(warning)}`))
  return lines.join('\n')
}

module.exports = { analyzeSubagents, parseAssumptions }
