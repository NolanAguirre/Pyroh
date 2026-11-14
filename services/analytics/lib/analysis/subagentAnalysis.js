const fs = require('fs')
const path = require('path')
const config = require('../config')
const { locateSession } = require('../source/harness')
const { readRecordPrompt } = require('../source/recordPrompt')
const usageStore = require('../source/usageStore')
const runIndex = require('../source/runIndexStore')
const { readJson } = require('../source/jsonFile')
const { parseInputCommand } = require('../../../../packages/prompt-triggers/index.js')
const { createRequestMetrics, summarizeRequestMetrics } = require('../source/requestMetrics')
const { readTranscript } = require('./transcriptContext')
const { createSubagentReplay } = require('./subagentReplay')

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
  if (typeof text !== 'string') throw Object.assign(new Error('Assumptions must be text.'), { status: 400 })
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

const collect = async (current, writeDir, cutoff) => {
  const warnings = new Set()
  const read = (file) => {
    try {
      return readJson(file)
    } catch (err) {
      warnings.add(`Cannot read ${file}: ${err.message}`)
      return null
    }
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
  const roots = [path.join(writeDir, 'sessions'), ...directories(path.join(writeDir, 'workspaces')).map(dir => path.join(dir, 'sessions'))]
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
  const locate = async (id) => {
    const local = await locateSession(id, writeDir)
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
    if (sources.has(source.sourceSessionId)) {
      warnings.add('Cycle in source-session links; stopped at the last distinct source.')
      break
    }
    const next = (await locate(source.sourceSessionId))?.session
    if (!next) {
      warnings.add(`Source session ${source.sourceSessionId} is unlocated; using ${source.id}.`)
      break
    }
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
  const allLinks = []
  const seen = new Set()
  const seenRuns = new Set()
  const pending = [{ id: source.id, ancestors: [], depth: 0 }]
  let excluded = 0
  while (pending.length) {
    const node = pending.pop()
    if (node.ancestors.includes(node.id)) {
      warnings.add(`Delegation cycle at ${node.id}; counted once.`)
      continue
    }
    if (seen.has(node.id)) continue
    seen.add(node.id)
    const location = await locate(node.id)
    if (!location?.session) {
      warnings.add(`Linked child ${node.id} is unlocated; its usage is unknown.`)
      continue
    }
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
        for (const item of usageStore.runRecords(node.id, dir)) records.set(item.record.id, item)
        usage = new Map(usageStore.listRunUsage(node.id, dir).map(item => [item.runId, item]))
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
    const transcript = readTranscript(dir, cutoff, warnings)
    const events = new Map()
    for (const entry of transcript) {
      if (!events.has(entry.event.runId)) events.set(entry.event.runId, [])
      events.get(entry.event.runId).push(entry.event)
    }
    const rows = []
    const containers = []
    const included = new Set()
    for (const { record, file } of records.values()) {
      if (record.startedAt > cutoff) continue
      if (node.depth && session.delegationDetached && !session.delegationDetached.runIds?.includes(record.id)) {
        warnings.add(`Excluded work after delegation ended in ${node.id}.`)
        continue
      }
      let local = Boolean(record.localCommand)
      if (!local && file && record.mode === 'agent') {
        try { local = Boolean(parseInputCommand(readRecordPrompt(record, file))) }
        catch { /* Missing prompts do not invalidate reported usage. */ }
      }
      if (local) {
        excluded += 1
        continue
      }
      const key = `${node.id}:${record.id}`
      if (seenRuns.has(key)) continue
      seenRuns.add(key)
      included.add(record.id)
      // Workflow controller runs are containers, not additive model usage.
      if (record.workflow) {
        containers.push({ record, file })
        excluded += 1
        continue
      }
      const complete = number(record.endedAt) && record.endedAt <= cutoff
      const provider = record.provider || session.provider
      const reported = usage.has(record.id) ? usage.get(record.id).usage : record.usage
      const tokens = measuredUsage(complete ? reported : null, provider)
      if (!complete) warnings.add(`Run ${record.id} was ongoing or lacked a completion timestamp at cutoff; usage is unknown.`)
      const evidence = requestEvidence(events.get(record.id) || [], tokens, provider, record.modelRequests, cutoff)
      rows.push({ ...tokens, requests: complete ? evidence.requests : null, requestFields: evidence.fields, requestEvidence: evidence,
        usageSource: { file: dir && fs.existsSync(path.join(dir, 'usage', `${record.id}.json`))
          ? path.join(dir, 'usage', `${record.id}.json`) : file, field: 'usage' },
        record, file, id: record.id, sessionId: node.id, provider, model: record.model || session.model || 'unknown',
        startedAt: record.startedAt, endedAt: complete ? record.endedAt : null, status: complete ? record.status || 'finished' : 'incomplete at cutoff' })
    }
    rows.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0) || a.id.localeCompare(b.id))
    agents.push({ id: node.id, depth: node.depth, session, dir, rows, containers, events: transcript })
    const links = [...(relations.get(node.id) || [])]
    for (const { record } of records.values()) {
      if (included.has(record.id)) for (const id of record.workflowChildren || []) links.push({ sessionId: id, parentRunId: record.id, workflow: true, createdAt: record.startedAt })
    }
    if (dir) {
      try {
        for (const { record: state, file: linkFile } of usageStore.jsonRecords(path.join(dir, 'delegation'))) {
          if (!state || !included.has(state.runId)) continue
          for (const child of Object.values(state.children || {})) {
            if (child.createdAt > cutoff) continue
            if (!child.sessionId) {
              warnings.add(`Unlocated child spawn in ${state.runId}${child.error ? `: ${child.error}` : ''}; no usage available.`)
              continue
            }
            hint(child.sessionId, child.sessionPath)
            links.push({ ...child, parentRunId: state.runId, source: { file: linkFile, field: `children.${child.resultId || child.sessionId}` } })
          }
        }
      } catch (err) { warnings.add(`Delegation links unavailable for ${node.id}: ${err.message}`) }
    }
    for (const link of links) {
      if (link.parentRunId && !included.has(link.parentRunId)) {
        if (records.has(link.parentRunId)) continue
        warnings.add(`Parent run ${link.parentRunId} for linked child ${link.sessionId} is missing; parent usage is unknown.`)
      }
      allLinks.push({ ...link, parentSessionId: node.id })
      pending.push({ id: link.sessionId, expectedRunId: link.runId, depth: node.depth + 1, ancestors: [...node.ancestors, node.id] })
    }
  }
  return { source, agents, links: allLinks, warnings: [...warnings], excluded, cutoff }
}

const rangeText = value => `${fmt(value.estimate)} (${fmt(value.lower)} to ${value.upper === null ? 'unknown upper bound' : fmt(value.upper)})`
const measuredText = value => value.value === null
  ? `unknown (${fmt(value.knownSubtotal)} known, ${value.coveredRuns}/${value.runs} runs)` : fmt(value.value)

const analyzeSubagents = async (sessionId, rawAssumptions = '') => {
  if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId === '.' || sessionId === '..'
    || /[\\/\0]/.test(sessionId)) {
    throw Object.assign(new Error('Invalid session ID.'), { status: 400 })
  }
  const assumptions = parseAssumptions(rawAssumptions)
  const writeDir = config.harnessWriteDir
  const location = await locateSession(sessionId, writeDir)
  const session = location && readJson(path.join(location.dir, 'session.json'))
  if (!session || session.id !== sessionId) {
    throw Object.assign(new Error('Session not found.'), { status: 404 })
  }
  const data = await collect(session, writeDir, Date.now())
  const replay = createSubagentReplay(data, assumptions)
  const destination = path.join(location.dir, 'analysis')
  fs.mkdirSync(destination, { recursive: true })
  const artifact = path.join(destination, `subagent-replay-${data.cutoff}.json`)
  fs.writeFileSync(artifact, `${JSON.stringify(replay, null, 2)}\n`)
  const lines = [
    '## Subagent analysis', '',
    'Whole coordinator replay, including recursively inserted child work and all later coordinator requests.', '',
    '| Measured usage | Input | Output | Total |',
    '| --- | ---: | ---: | ---: |',
    ...Object.entries(replay.measured).map(([label, values]) => `| ${label} | ${measuredText(values.input)} | ${measuredText(values.output)} | ${measuredText(values.total)} |`),
    '',
    `Replay input: ${rangeText(replay.estimate.input)}.`,
    `Replay generated output: ${rangeText(replay.estimate.output)}.`,
    `Replay total: ${rangeText(replay.estimate.total)}.`,
    `Replay minus measured combined total: ${rangeText(replay.estimate.difference)}. Positive means more tokens in this scenario.`,
    '',
    `Turns: ${replay.confidenceCounts.measured} measured, ${replay.confidenceCounts.inferred} inferred, ${replay.confidenceCounts.allocated} allocated. Removed ${replay.removed.blocks} blocks and ${replay.removed.turns} justified empty turns.`,
    `Coverage cutoff: ${new Date(data.cutoff).toISOString()}. ${replay.coverage.complete ? 'All replay regions have calibration coverage.' : `${replay.coverage.gaps.length} recorded gaps, ${replay.coverage.unplacedSessions.length} unplaced sessions. Unknown upper bounds remain explicit.`}`,
    `First unsupported turn: ${replay.coverage.firstUnsupportedTurn || 'none'}.`,
    '',
    ...replay.tokenizer.identities.map(identity => `Tokenizer: ${cell(identity.package)} ${cell(identity.version || 'unavailable')}, ${cell(identity.encoding)}, model ${cell(identity.model)}${identity.approximation ? ' (proxy encoding)' : ''}. ${cell(identity.unavailable || identity.reason)}`),
    'Requests are tokenized as assembled retained histories. Original-session calibration uses response input only, with signed residuals kept as uncertainty. Tool results are not generated output. Hidden reasoning counts are never appended as text.',
    'Ranges are sensitivity estimates, not guarantees. Missing content, response boundaries, compaction or model coverage can leave the upper bound unknown. The point estimate covers placed recorded work only.',
    'Child insertion follows spawn points, then creation time and session ID. Unique findings, instructions, refreshes, edited-file reads and the final answer remain unless exact replacement is proven.',
    '',
    `[Full replay evidence and assumptions](${artifact})`,
    'The JSON includes full turns, blocks, dispositions, source links, deterministic order, run-total attribution, measured usage and calibration samples. This is a token scenario, not a quality, time or cost verdict.',
  ]
  if (Object.keys(assumptions).length) lines.push('', 'Legacy shared/requests/output overrides are recorded in the artifact but are not applied to ordered replay.')
  if (replay.coverage.gaps.length) lines.push('', ...replay.coverage.gaps.slice(0, 5).map(item => `- ${cell(item.reason)}`))
  return { report: lines.join('\n'), artifact }
}

module.exports = { analyzeSubagents, parseAssumptions, requestEvidence }
