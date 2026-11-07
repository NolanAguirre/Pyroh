const tokenFields = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']
const number = (value) => Number.isSafeInteger(value) && value >= 0
const sum = (values) => values.every(number) && number(values.reduce((a, b) => a + b, 0))
  ? values.reduce((a, b) => a + b, 0) : null

// Capability describes the exposed protocol, not SDK sends or tool batches.
const capabilities = {
  claude: {
    support: 'supported', scope: 'main_agent_loop',
    provenance: 'claude-agent-sdk: Messages API message.id, message_delta usage, message_stop; result.num_turns',
    limitation: 'Matches result.usage (main loop only). Native subagents, sidechains, helpers and hidden calls are outside this scope; retries without a completed response are not counted.',
  },
  codex: {
    support: 'partial', scope: 'provider_run',
    provenance: 'codex app-server optional rawResponse/completed IDs/usage and token snapshots; opt-in OTLP API/SSE/WebSocket event records',
    limitation: 'Optional raw completion IDs are partial evidence; delivery coverage is not established for every send/resume. Snapshots are not requests. Telemetry can be delayed, dropped or missing response/turn identity; API attempts and stream events are not unique completed model responses. Exact counts and request averages remain unknown.',
  },
  cursor: {
    support: 'partial', scope: 'main_agent_loop',
    provenance: '@cursor/sdk onDelta: top-level tool modelCallId; stepId/stepDurationMs; turn-ended usage',
    limitation: 'Tool-linked modelCallIds are partial observations: calls without tools may be absent. Steps and SDK requestId are not model requests; step durations are not request latency. Nested task updates are excluded. Per-request usage and final response boundaries are unavailable.',
  },
}

const totalUsage = (rows) => Object.fromEntries(tokenFields.map(key => [key, rows.length
  ? sum(rows.map(row => row?.[key])) : null]))

// One collector per harness steering segment. Snapshots replace by response ID.
const createRequestMetrics = ({ provider, segmentId, startedAt = Date.now() }) => {
  const capability = capabilities[provider] || { support: 'unsupported', scope: 'provider_run',
    provenance: provider, limitation: 'No model-request instrumentation for this provider.' }
  const requests = new Map()
  const evidence = new Map()
  let finalResult = null
  let endedAt = null
  const observe = (event) => {
    if (event.provider !== provider || event.parentToolUseId || event.nested) return false
    if (event.type === 'model_request_evidence') {
      if (!event.evidenceId) return false
      evidence.set(event.evidenceId, { ...event, observedAt: event.observedAt ?? Date.now() })
      return true
    }
    if (!event.requestId) return false
    // Cursor IDs belong to one send. Claude message IDs identify a response
    // across streaming snapshots and steering segments.
    const requestKey = JSON.stringify([provider, provider === 'claude' ? 'message'
      : event.evidenceScopeId || event.providerRunId || event.runId || segmentId, event.requestId])
    const previous = requests.get(requestKey)
    // A late block snapshot must not replace final streaming usage.
    if (previous?.status === 'completed' && event.status !== 'completed'
      && event.provenance !== 'messages_api_stream') return false
    const observedAt = event.observedAt ?? Date.now()
    requests.set(requestKey, { ...previous, ...event, requestKey,
      firstObservedAt: previous?.firstObservedAt ?? observedAt, lastObservedAt: observedAt })
    return true
  }
  const snapshot = (result) => {
    if (result) { finalResult = result; endedAt = endedAt ?? Date.now() }
    result = finalResult
    const rows = [...requests.values()]
    const completed = rows.filter(row => row.status === 'completed')
    const coveredUsage = totalUsage(completed.map(row => row.usage))
    const matchedFields = tokenFields.filter(key => number(result?.usage?.[key])
      && coveredUsage[key] === result.usage[key])
    const reportedCount = number(result?.reportedModelRequests) ? result.reportedModelRequests : null
    const complete = capability.support === 'supported' && result?.status === 'completed'
      && rows.length > 0 && completed.length === rows.length
      && matchedFields.includes('inputTokens') && matchedFields.includes('outputTokens')
      && (reportedCount === null || reportedCount === rows.length)
    const reason = capability.support !== 'supported' ? capability.limitation
      : !result ? 'Request stream is still open.'
      : result.status !== 'completed' ? 'Interrupted or failed segment; request coverage is incomplete.'
      : !rows.length ? 'No identified model responses were observed.'
      : completed.length !== rows.length ? 'Some responses lack a final boundary.'
      : reportedCount !== null && reportedCount !== rows.length ? 'Observed responses do not match provider-reported model round trips.'
      : !complete ? 'Request input/output does not reconcile with authoritative segment usage.' : null
    const records = [...evidence.values()]
    const times = [...rows.flatMap(row => [row.firstObservedAt, row.lastObservedAt]), ...records.map(row => row.observedAt)].filter(number)
    return { version: 2, provider, segmentId, ...capability, startedAt, endedAt,
      coverage: complete ? 'complete' : capability.support === 'unsupported' ? 'unsupported' : 'partial',
      requests: complete ? rows.length : null, estimatedRequests: null,
      observedRequests: rows.length || (provider === 'claude' || records.some(row => row.kind === 'capture_started') ? 0 : null),
      completedRequests: completed.length, requestIds: rows.map(row => row.requestId),
      requestKeys: rows.map(row => row.requestKey), requestRecords: rows, evidence: records,
      telemetryCaptures: [...new Set(records.map(row => row.captureId).filter(Boolean))],
      firstObservedAt: times.length ? Math.min(...times) : null,
      lastObservedAt: times.length ? Math.max(...times) : null,
      coveredUsage, matchedFields: complete ? matchedFields : [], reportedModelRequests: reportedCount,
      status: result?.status || 'running', reason }
  }
  return { segmentId, observe, snapshot }
}

const summarizeRequestMetrics = (segments) => {
  const identities = segments.flatMap(segment => segment.requestKeys
    || (segment.requestIds || []).map(id => JSON.stringify([segment.provider, segment.provider === 'claude' ? 'message' : segment.segmentId, id])))
  const unique = new Set(identities)
  const duplicate = unique.size !== identities.length
  const complete = segments.length > 0 && !duplicate && segments.every(segment => segment.coverage === 'complete')
  return { version: 2, coverage: complete ? 'complete'
    : segments.length && segments.every(segment => segment.coverage === 'unsupported') ? 'unsupported' : 'partial',
  requests: complete ? sum(segments.map(segment => segment.requests)) : null,
  estimatedRequests: null,
  observedRequests: segments.some(segment => number(segment.observedRequests)) ? unique.size : null,
  coveredUsage: totalUsage(segments.map(segment => segment.coveredUsage)),
  matchedFields: complete ? tokenFields.filter(key => segments.every(segment => segment.matchedFields?.includes(key))) : [],
  reason: duplicate ? 'A response ID appeared in multiple steering segments; ownership is ambiguous.' : null,
  segments }
}

module.exports = { createRequestMetrics, summarizeRequestMetrics }
