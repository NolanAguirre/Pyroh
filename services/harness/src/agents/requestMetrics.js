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
    support: 'unsupported', scope: 'provider_run',
    provenance: 'codex app-server: thread/tokenUsage/updated {threadId, turnId, tokenUsage: {total, last, modelContextWindow}}',
    limitation: 'No model-response ID or guaranteed one-notification-per-request boundary. Cumulative/last snapshots and item IDs cannot establish a request count.',
  },
  cursor: {
    support: 'unsupported', scope: 'provider_run',
    provenance: '@cursor/sdk: SDKUsageMessage from turn-ended; RunResult.usage sums reported agent turns',
    limitation: 'Public messages omit internal modelCallId and step boundaries. request_id identifies the SDK run execution; turn-ended usage can cover multiple model calls.',
  },
}

const totalUsage = (rows) => Object.fromEntries(tokenFields.map(key => [key, rows.length
  ? sum(rows.map(row => row?.[key])) : null]))

// One collector per harness steering segment. Snapshots replace by response ID.
const createRequestMetrics = ({ provider, segmentId }) => {
  const capability = capabilities[provider] || { support: 'unsupported', scope: 'provider_run',
    provenance: provider, limitation: 'No model-request instrumentation for this provider.' }
  const requests = new Map()
  const observe = (event) => {
    if (event.provider !== provider || !event.requestId || event.parentToolUseId) return
    const previous = requests.get(event.requestId)
    // A late block snapshot must not replace final streaming usage.
    if (previous?.status === 'completed' && event.status !== 'completed'
      && event.provenance !== 'messages_api_stream') return
    requests.set(event.requestId, event)
  }
  const snapshot = (result) => {
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
    const reason = capability.support === 'unsupported' ? capability.limitation
      : !result ? 'Request stream is still open.'
      : result.status !== 'completed' ? 'Interrupted or failed segment; request coverage is incomplete.'
      : !rows.length ? 'No identified model responses were observed.'
      : completed.length !== rows.length ? 'Some responses lack a final boundary.'
      : reportedCount !== null && reportedCount !== rows.length ? 'Observed responses do not match provider-reported model round trips.'
      : !complete ? 'Request input/output does not reconcile with authoritative segment usage.' : null
    return { version: 1, provider, segmentId, ...capability,
      coverage: complete ? 'complete' : capability.support === 'unsupported' ? 'unsupported' : 'partial',
      requests: complete ? rows.length : null, observedRequests: rows.length,
      completedRequests: completed.length, requestIds: rows.map(row => row.requestId),
      coveredUsage, matchedFields: complete ? matchedFields : [], reportedModelRequests: reportedCount,
      status: result?.status || 'running', reason }
  }
  return { segmentId, observe, snapshot }
}

const summarizeRequestMetrics = (segments) => {
  const identities = segments.flatMap(segment => (segment.requestIds || []).map(id => `${segment.provider}:${id}`))
  const unique = new Set(identities)
  const duplicate = unique.size !== identities.length
  const complete = segments.length > 0 && !duplicate && segments.every(segment => segment.coverage === 'complete')
  return { version: 1, coverage: complete ? 'complete'
    : segments.length && segments.every(segment => segment.coverage === 'unsupported') ? 'unsupported' : 'partial',
  requests: complete ? sum(segments.map(segment => segment.requests)) : null,
  observedRequests: unique.size, coveredUsage: totalUsage(segments.map(segment => segment.coveredUsage)),
  matchedFields: complete ? tokenFields.filter(key => segments.every(segment => segment.matchedFields?.includes(key))) : [],
  reason: duplicate ? 'A response ID appeared in multiple steering segments; ownership is ambiguous.' : null,
  segments }
}

module.exports = { createRequestMetrics, summarizeRequestMetrics }
