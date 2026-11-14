const fs = require('fs')
const path = require('path')
const usageStore = require('../store/usageStore')
const { readRecordPrompt } = require('../store/recordPrompt')
const { parseInputCommand } = require('../prompt/triggers')

const MAX_CALIBRATION_TOKENS = 2_000_000
const DEFAULT_INPUT_PER_TURN = 8_000
const DEFAULT_TURNS_PER_RUN = 3
const positive = value => Number.isFinite(value) && value > 0
const median = values => {
  const sorted = values.filter(positive).sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length ? (sorted[middle] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2 : null
}
const size = value => value == null ? 0 : (typeof value === 'string' ? value : JSON.stringify(value)).length
const compacted = event => ['compacting', 'awaiting_update'].includes(event.context?.status)
  || /^(?:Context compacted|Compacting context)/i.test(event.status || '')
  || /compact/i.test(event.message?.subtype || event.message?.type || '')

// Count conversation content, not JSON envelopes, telemetry, or duplicate stream
// snapshots. A single latest context/character pair gives each agent one vote.
const readProfile = ({ session, dir }, writeDir, cutoff) => {
  const runs = new Map()
  let events
  let total = 0
  let usageKnown = true
  try {
    events = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').split('\n')
      .filter(line => line.trim()).map(line => JSON.parse(line))
      .filter(event => Number.isFinite(event.ts) && event.ts <= cutoff)
    const usage = new Map(usageStore.listRunUsage(session.id, writeDir, dir).map(entry => [entry.runId, entry.usage]))
    for (const { record, file } of usageStore.runRecords(session.id, writeDir, dir)) {
      if (record.startedAt > cutoff || record.localCommand || record.workflow) continue
      const prompt = readRecordPrompt(record, file)
      if (parseInputCommand(prompt)) continue
      const reported = usage.get(record.id) ?? record.usage
      const tokens = usageStore.normalizeUsage(reported, record.provider || session.provider)
      const input = reported?.inputTokens ?? reported?.input_tokens ?? reported?.input
      const output = reported?.outputTokens ?? reported?.output_tokens ?? reported?.output
      if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0
        || !Number.isFinite(record.endedAt) || record.endedAt > cutoff || record.transcriptStatus === 'incomplete') usageKnown = false
      if (!tokens) usageKnown = false
      else total += tokens.input + tokens.output
      runs.set(record.id, { record, prompt, start: null, end: null, contexts: [] })
    }
  } catch {
    return { runs, reason: 'Transcript or usage is incomplete.' }
  }
  const captured = new Set(events.filter(event => event.type === 'provider_prompt').map(event => event.runId))
  for (const [runId, run] of runs) {
    if (!captured.has(runId)) events.push({ type: 'provider_prompt', runId, text: run.prompt, ts: run.record.startedAt })
  }
  events.sort((a, b) => a.ts - b.ts)
  const items = new Map()
  const textRuns = new Set()
  const snapshots = []
  const threads = new Set()
  let chars = 0
  let sequence = 0
  let hasCompaction = false
  let lastContext = null
  const replace = (key, value) => {
    chars += size(value) - size(items.get(key))
    items.set(key, value)
  }
  for (const event of events) {
    if (compacted(event)) hasCompaction = true
    const run = runs.get(event.runId)
    if (!run) continue
    if (event.providerAgentId) threads.add(event.providerAgentId)
    if (event.context?.providerAgentId) threads.add(event.context.providerAgentId)
    const id = event.itemId || event.toolUseId || `anonymous-${sequence++}`
    const key = `${event.runId}:${event.type}:${id}`
    if (event.type === 'provider_prompt') {
      replace(`${event.runId}:prompt:${event.captureId || id}`, event.text)
      if (run.start === null) run.start = chars
    } else if (['text', 'thinking'].includes(event.type)) {
      replace(key, event.delta && !event.replace ? (items.get(key) || '') + (event.text || '') : event.text)
      if (event.type === 'text' && event.text) textRuns.add(event.runId)
    } else if (event.type === 'result' && !textRuns.has(event.runId)) {
      replace(`${event.runId}:result`, event.result)
    } else if (event.type === 'user' && !captured.has(event.runId)) {
      replace(key, event.text)
    } else if (event.type === 'tool_call') {
      for (const field of ['name', 'input', 'output']) {
        if (event[field] !== undefined) replace(`${key}:${field}`, event[field])
      }
      if (event.outputDelta !== undefined) replace(`${key}:output`, (items.get(`${key}:output`) || '') + event.outputDelta)
    } else if (event.type === 'context') {
      const used = event.context?.usedTokens
      if (positive(used)) {
        if (lastContext && used < lastContext * 0.75) hasCompaction = true
        lastContext = used
        run.contexts.push(used)
        snapshots.push({ used, chars, runId: event.runId })
      }
    }
    run.end = chars
  }
  const latestRun = [...runs.values()].sort((a, b) => (a.record.startedAt || 0) - (b.record.startedAt || 0)).at(-1)
  const context = snapshots.at(-1)
  const reason = hasCompaction ? 'Compaction detected.'
    : session.fork || threads.size > 1 ? 'Inherited or reset context cannot be matched to this transcript.'
      : total > MAX_CALIBRATION_TOKENS || (session.totals?.tokens?.total || 0) > MAX_CALIBRATION_TOKENS
        ? 'Agent exceeds 2M reported tokens.' : null
  return { session, runs, chars, context, reason, usageKnown,
    provider: latestRun?.record.provider || session.provider }
}

const createContextAnalysis = (sources, writeDir, cutoff, agents = []) => {
  const profiles = new Map(sources.filter(source => source.dir).map(source =>
    [source.session.id, readProfile(source, writeDir, cutoff)]))
  const samples = [...profiles.values()].filter(profile => !profile.reason && profile.usageKnown
    && ['codex', 'claude'].includes(profile.provider) && positive(profile.context?.chars)
    && positive(profile.context?.used) && profile.context.used <= MAX_CALIBRATION_TOKENS
    && [...profile.runs.values()].every(run => (run.record.provider || profile.session.provider) === profile.provider))
  const ratio = samples.length ? samples.reduce((sum, profile) => sum + profile.context.used / profile.context.chars, 0) / samples.length : null
  const history = agents.flatMap(agent => agent.rows).filter(row => positive(row.requests)
    && row.requestFields?.includes('input') && positive(row.input))
  const describe = (agent) => {
    const profile = profiles.get(agent.id)
    const selected = agent.rows.map(row => ({ row, run: profile?.runs.get(row.id) }))
    const last = selected.at(-1)
    const knownContext = profile?.context && profile.context.runId === last?.row.id ? profile.context.used : null
    const canEstimate = profile && !profile.reason && profile.usageKnown && ratio !== null
    const current = knownContext ?? (canEstimate && positive(last?.run?.end) ? last.run.end * ratio : null)
    const rows = selected.map(({ row, run }) => {
      const measured = row.requests > 0 && row.requestFields?.includes('input') && row.input !== null
      const providerHistory = history.filter(item => item.provider === row.provider)
      const modelHistory = providerHistory.filter(item => item.model === row.model)
      const peers = modelHistory.length ? modelHistory : providerHistory
      const historicalInput = median(peers.map(item => item.input / item.requests))
      const historicalTurns = median(peers.map(item => item.requests))
      const contexts = run?.contexts || []
      const reportedContext = contexts.length ? contexts.reduce((total, value) => total + value, 0) / contexts.length : null
      const transcriptContext = canEstimate && positive(run?.start) && positive(run?.end)
        ? (run.start + run.end) / 2 * ratio : null
      const avg = measured ? row.input / row.requests
        : reportedContext ?? transcriptContext ?? historicalInput ?? DEFAULT_INPUT_PER_TURN
      const segments = row.requestEvidence?.segments || []
      const reported = segments.length && segments.every(segment => Number.isSafeInteger(segment.reportedModelRequests)
        && segment.reportedModelRequests >= 0)
        ? segments.reduce((total, segment) => total + segment.reportedModelRequests, 0) : null
      let basis = 'measured requests'
      let turns = row.requests
      if (turns == null) {
        if (positive(reported)) {
          turns = reported
          basis = 'provider-reported turns (unreconciled)'
        } else if (positive(row.input)) {
          turns = row.input / avg
          basis = reportedContext !== null ? 'input ÷ average reported context'
            : transcriptContext !== null ? 'input ÷ calibrated transcript context'
              : historicalInput !== null ? `input ÷ median input/turn from ${peers.length} measured runs`
                : 'rough fallback: input ÷ 8,000 tokens/turn'
        } else {
          turns = historicalTurns ?? DEFAULT_TURNS_PER_RUN
          basis = historicalTurns !== null ? `median turns from ${peers.length} measured runs`
            : 'rough fallback: 3 turns/run'
        }
        // Observed response IDs are a lower bound, never an exact count.
        const observed = row.requestEvidence?.observed || 0
        if (observed > Math.round(turns)) basis += ' (raised to observed response count)'
        turns = Math.max(1, observed, Math.round(turns))
      }
      return { turns, avg: measured ? avg : turns > 0 && row.input !== null ? row.input / turns : avg,
        estimated: row.requests == null, basis }
    })
    const turns = rows.length && rows.every(row => row.turns !== null) ? rows.reduce((sum, row) => sum + row.turns, 0) : null
    const avg = turns > 0 && rows.every(row => row.avg !== null)
      ? rows.reduce((sum, row) => sum + row.avg * row.turns, 0) / turns : null
    return { current, currentEstimated: knownContext === null && current !== null,
      turns, turnsEstimated: rows.some(row => row.estimated), avg,
      turnBasis: [...new Set(rows.map(row => row.basis))].join(', '),
      reason: profile?.reason || (!samples.length ? 'No eligible GPT/Claude context samples.' : null) }
  }
  return { samples: samples.length, describe }
}

module.exports = { createContextAnalysis }
