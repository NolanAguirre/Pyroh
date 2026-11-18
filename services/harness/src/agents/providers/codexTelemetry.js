const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const config = require('../../config')
const { readJson, writeJson } = require('../../store/jsonFile')
const eventLog = require('../../store/eventLog')
const { createReader } = require('./codexEvidence')

const validId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)
const captureDir = (writeDir, id) => {
  if (!validId(id)) throw new Error('Invalid Codex telemetry capture ID')
  return path.join(writeDir, 'model-request-evidence', 'codex', id)
}

// App-server runs in the session daemon, while HTTP runs in the API process.
// A disk mailbox survives either process and accepts delayed exporter batches.
const createCapture = ({ writeDir, sessionId, runId }) => {
  const id = crypto.randomBytes(16).toString('hex')
  const token = crypto.randomBytes(32).toString('hex')
  const dir = captureDir(writeDir, id)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const manifest = { version: 1, id, token, sessionId, runId, createdAt: Date.now(), segments: {} }
  const readers = new Map()
  const save = () => writeJson(path.join(dir, 'capture.json'), manifest)
  save()
  const endpoint = `${config.publicUrl}/api/provider-telemetry/codex/${id}/v1/logs`
  const configArgs = [
    '-c', `otel.exporter={otlp-http={endpoint=${JSON.stringify(endpoint)},protocol="json",headers={"x-harness-telemetry-token"=${JSON.stringify(token)}}}}`,
    '-c', 'otel.log_user_prompt=false',
    '-c', 'otel.tool_result.max_bytes=0',
  ]
  const startSegment = ({ segmentId, threadId, startedAt }) => {
    manifest.segments[segmentId] = { segmentId, threadId, startedAt, providerRunId: null, endedAt: null }
    save()
  }
  const bindTurn = (segmentId, turnId) => {
    const segment = manifest.segments[segmentId]
    if (!segment || !turnId || segment.providerRunId === turnId) return
    // Never silently reassign a segment to a different provider turn.
    if (segment.providerRunId) { segment.ambiguous = true; save(); return }
    segment.providerRunId = turnId
    save()
  }
  const endSegment = (segmentId, status) => {
    const segment = manifest.segments[segmentId]
    if (!segment || segment.endedAt !== null) return
    segment.endedAt = Date.now()
    segment.status = status
    save()
  }
  const closed = () => { manifest.closedAt = Date.now(); save() }
  const drain = () => readEvidence({ segments: Object.values(manifest.segments)
    .map(segment => ({ ...segment, telemetryCaptures: [id] })),
  writeDir, sessionId, runId, cutoff: Date.now(), readers })
  return { id, configArgs, startSegment, bindTurn, endSegment, closed, drain }
}

const eventNames = new Set(['codex.api_request', 'codex.sse_event', 'codex.websocket_request', 'codex.websocket_event'])
// Keep transport/usage evidence only. Never persist prompts, tool payloads,
// account data, authorization metadata, or arbitrary log bodies.
const attributeNames = new Set([
  'event.name', 'event.timestamp', 'event.kind', 'conversation.id', 'turn.id',
  'model', 'app.version', 'session_source', 'service.name', 'service.version',
  'attempt', 'http.response.status_code', 'status', 'success', 'duration_ms',
  'input_token_count', 'output_token_count', 'cached_token_count',
  'cache_write_token_count', 'reasoning_token_count', 'ttft_ms', 'error.type',
  'response.id', 'response_id', 'request.id', 'request_id', 'total_token_count',
])
const scalar = value => {
  for (const key of ['stringValue', 'string_value', 'intValue', 'int_value', 'doubleValue', 'double_value', 'boolValue', 'bool_value']) {
    if (typeof value?.[key] === 'string' || typeof value?.[key] === 'number' || typeof value?.[key] === 'boolean') return value[key]
  }
  return null
}
const attributes = values => Object.fromEntries((Array.isArray(values) ? values : [])
  .filter(item => attributeNames.has(item?.key))
  .map(item => [item.key, scalar(item.value)]).sort(([a], [b]) => a.localeCompare(b)))
const timestampMs = (nano, timestamp) => {
  if (typeof nano === 'string' && /^\d+$/.test(nano)) {
    const value = Number(BigInt(nano) / 1000000n)
    if (Number.isSafeInteger(value) && value > 0) return value
  }
  const value = typeof timestamp === 'string' ? Date.parse(timestamp) : NaN
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

const evidenceEvent = (record, captureId) => ({
  type: 'model_request_evidence', version: 2, provider: 'codex', kind: 'otlp_request',
  evidenceId: `${captureId}:${record.evidenceId}`, captureId,
  providerAgentId: record.attributes?.['conversation.id'] || null,
  providerRunId: record.attributes?.['turn.id'] || null,
  responseId: record.attributes?.['response.id'] || record.attributes?.response_id || null,
  observedAt: record.receivedAt, occurredAt: record.occurredAt,
  eventName: record.eventName, attributes: record.attributes,
  traceId: record.traceId, spanId: record.spanId,
  provenance: 'codex OTLP JSON logs',
  timingSemantics: 'provider event timestamp and duration; not a unique response boundary',
})

const receive = (req, res, next) => {
  try {
    if (!validId(req.params.captureId)) return res.status(404).end()
    const dir = captureDir(config.writeDir, req.params.captureId)
    const manifest = readJson(path.join(dir, 'capture.json'))
    const token = req.get('x-harness-telemetry-token')
    if (!manifest || typeof token !== 'string' || token.length !== manifest.token?.length
      || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(manifest.token))) return res.status(403).end()
    const resources = req.body?.resourceLogs ?? req.body?.resource_logs
    if (!Array.isArray(resources)) return res.status(400).json({ error: 'Expected OTLP JSON resourceLogs' })
    const receivedAt = Date.now()
    const records = []
    for (const resource of resources) {
      const resourceAttributes = attributes(resource.resource?.attributes)
      for (const scope of resource.scopeLogs || resource.scope_logs || []) {
        for (const log of scope.logRecords || scope.log_records || []) {
          const attrs = { ...resourceAttributes, ...attributes(log.attributes) }
          const eventName = attrs['event.name'] || log.eventName || log.event_name
          if (!eventNames.has(eventName)) continue
          const timeUnixNano = log.timeUnixNano ?? log.time_unix_nano ?? null
          const record = { eventName, timeUnixNano, attributes: attrs,
            traceId: log.traceId ?? log.trace_id ?? null, spanId: log.spanId ?? log.span_id ?? null }
          // This identifies a log observation, NEVER a model request. Retries
          // of the same OTLP batch are deduplicated when the evidence is read.
          const evidenceId = crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex')
          records.push({ ...record, evidenceId, receivedAt,
            occurredAt: timestampMs(timeUnixNano, attrs['event.timestamp']) })
        }
      }
    }
    if (records.length) {
      // Stable observation IDs deduplicate exporter retries across API restarts.
      // Keep the sanitized record as durable evidence even if delivery fails.
      const recordDir = path.join(dir, 'records')
      fs.mkdirSync(recordDir, { recursive: true, mode: 0o700 })
      const fresh = []
      for (const record of records) {
        try {
          fs.writeFileSync(path.join(recordDir, `${record.evidenceId}.json`), JSON.stringify(record), { flag: 'wx', mode: 0o600 })
          fresh.push(record)
        } catch (err) { if (err.code !== 'EEXIST') throw err }
      }
      const fd = fs.openSync(path.join(dir, 'events.jsonl'), 'a', 0o600)
      try {
        if (fresh.length) fs.writeFileSync(fd, fresh.map(record => JSON.stringify(record)).join('\n') + '\n')
        fs.fsyncSync(fd)
      }
      finally { fs.closeSync(fd) }
      for (const record of fresh) {
        const matches = Object.values(manifest.segments || {}).filter(segment => !segment.ambiguous
          && segment.threadId === record.attributes['conversation.id']
          && segment.providerRunId && segment.providerRunId === record.attributes['turn.id'])
        // Late batches still reach the session after its daemon has exited.
        // Unbound records remain evidence without inventing turn ownership.
        eventLog.append(manifest.sessionId, { ...evidenceEvent(record, manifest.id),
          runId: manifest.runId, segmentId: matches.length === 1 ? matches[0].segmentId : null,
          attribution: matches.length === 1 ? 'thread_and_turn' : 'unattributed' }, config.writeDir)
      }
    }
    res.json({})
  } catch (err) { next(err) }
}

// Analysis reads the mailbox at its own cutoff, including batches delivered
// after the daemon finalized its run. Arrival time is not a request timestamp.
const readEvidence = ({ segments, writeDir, sessionId, runId, cutoff, readers = new Map() }) => {
  const bySegment = new Map(segments.map(segment => [segment.segmentId, []]))
  const issues = new Set()
  const captures = new Set(segments.flatMap(segment => segment.telemetryCaptures || []))
  let unattributed = 0
  let excluded = 0
  for (const id of captures) {
    try {
      const dir = captureDir(writeDir, id)
      const manifest = readJson(path.join(dir, 'capture.json'))
      if (!manifest || manifest.sessionId !== sessionId || manifest.runId !== runId) {
        issues.add('Codex telemetry capture metadata is missing or belongs to another run.')
        continue
      }
      if (!readers.has(id)) readers.set(id, { reader: createReader(path.join(dir, 'events.jsonl')), pending: [] })
      const state = readers.get(id)
      const batch = state.reader.read()
      if (batch.issue && batch.issue !== 'ENOENT') issues.add(`Codex telemetry unavailable: ${batch.issue}`)
      if (batch.remaining) issues.add('Codex telemetry has unread evidence beyond the bounded drain.')
      if (batch.skipped) issues.add('Codex telemetry contains skipped or oversized records.')
      const records = [...state.pending, ...batch.records]
      state.pending = []
      const bindings = Object.values(manifest.segments || {}).filter(segment => bySegment.has(segment.segmentId))
      for (const record of records) {
        if (!Number.isSafeInteger(record?.receivedAt) || !record.evidenceId) continue
        const threadId = record.attributes?.['conversation.id']
        const turnId = record.attributes?.['turn.id']
        const matchingThreads = bindings.filter(segment => segment.threadId === threadId)
        if (threadId && !matchingThreads.length) { excluded += 1; continue }
        const matches = threadId && turnId ? matchingThreads.filter(segment => !segment.ambiguous
          && segment.providerRunId === turnId) : []
        if (matches.length !== 1 || record.receivedAt > cutoff) {
          unattributed += 1
          if (turnId && (record.receivedAt > cutoff || matchingThreads.some(segment => !segment.providerRunId))) {
            if (state.pending.length < 1024) state.pending.push(record)
            else issues.add('Codex telemetry pending attribution limit reached.')
          }
          continue
        }
        bySegment.get(matches[0].segmentId).push({ ...evidenceEvent(record, id),
          attribution: 'thread_and_turn', sessionPersisted: true })
      }
    } catch (err) { issues.add(`Codex telemetry unavailable: ${err.code || err.message}`) }
  }
  return { bySegment, unattributed, excluded, issues: [...issues] }
}

module.exports = { createCapture, receive, readEvidence }
