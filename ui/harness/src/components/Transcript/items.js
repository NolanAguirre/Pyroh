import { isMarkdownPlan, isPlanTool } from './plan'

// Item IDs belong to a provider turn. Merge replayed deltas exactly as live ones,
// and replace them with the authoritative completed item when it arrives.
export const transcriptItems = (events) => {
  const rows = []
  const byId = new Map()
  for (const event of events) {
    if (event.type === 'usage' || event.type === 'context' || event.type === 'question'
      || event.type === 'model_request' || event.type === 'model_request_metrics') continue
    if (!event.itemId) {
      const last = rows[rows.length - 1]
      if ((event.type === 'text' || event.type === 'thinking') && last && !last.itemId
        && last.type === event.type && last.runId === event.runId) {
        rows[rows.length - 1] = { ...last, text: (last.text || '') + (event.text || '') }
      } else rows.push(event)
      continue
    }
    const key = `${event.runId}:${event.type}:${event.itemId}`
    const index = byId.get(key)
    const previous = index === undefined ? {} : rows[index]
    const next = { ...previous, ...Object.fromEntries(Object.entries(event).filter(([, value]) => value !== undefined)) }
    if (event.delta) next.text = (previous.text || '') + (event.text || '')
    if (event.outputDelta !== undefined) next.output = (previous.output || '') + event.outputDelta
    if (index === undefined) {
      byId.set(key, rows.length)
      rows.push(next)
    } else rows[index] = next
  }
  return rows
}

const isBlock = (event) => event.type === 'tool_call' || event.type === 'plan' || event.type === 'diff' || event.type === 'user'

export const userEvents = (runs) => runs.flatMap((run) => {
  if (typeof run.prompt !== 'string' || run.prompt === '') return []
  return [{ type: 'user', text: run.prompt, runPrompt: true, runId: run.id, ts: run.startedAt || 0, itemId: `user:${run.id}` }]
})

// Pair captured provider input with its source message after replayed items have
// been merged. Further sends remain visible, including retries and continuations.
export const withProviderPrompts = (events) => {
  const messages = new Map()
  const attached = new Map()
  const consumed = new Set()
  events.forEach((event, index) => {
    if (event.type === 'user' && event.itemId) messages.set(`${event.runId}:${event.itemId}`, index)
  })
  events.forEach((event, index) => {
    if (event.type !== 'provider_prompt' || typeof event.text !== 'string') return
    // Older Cursor captures did not identify their source. Only the first can
    // safely be associated with the opening message.
    const sourceId = event.userItemId || `user:${event.runId}`
    const messageIndex = messages.get(`${event.runId}:${sourceId}`)
    if (messageIndex === undefined || attached.has(messageIndex)) return
    attached.set(messageIndex, event)
    consumed.add(index)
  })
  return events.flatMap((event, index) => {
    if (consumed.has(index)) return []
    if (attached.has(index)) return [{ ...event, providerPrompt: attached.get(index) }]
    if (event.type === 'provider_prompt') {
      if (typeof event.text !== 'string') return []
      return [{ ...event, type: 'user', providerPrompt: event, generatedPrompt: true }]
    }
    return [event]
  })
}

const answerText = (answer) => {
  if (Array.isArray(answer)) return answer.map(answerText).join('\n')
  if (answer && typeof answer === 'object') return JSON.stringify(answer, null, 2)
  return answer == null ? '' : String(answer)
}

export const questionEvents = (questions) => questions.flatMap((question) => {
  const events = [{
    type: 'question_message',
    text: question.question,
    runId: question.runId,
    ts: question.createdAt || 0,
    itemId: `question:${question.id}`,
  }]
  if (question.status === 'answered') events.push({
    type: 'user',
    text: question.secret ? 'Secret answer hidden' : answerText(question.answer),
    answer: true,
    runId: question.runId,
    ts: question.answeredAt || question.createdAt || 0,
    itemId: `answer:${question.id}`,
  })
  return events
})

export const hideRecordedPlanText = (events) => {
  const runsWithPlan = new Set()
  for (const event of events) {
    if (event.type === 'tool_call' && isPlanTool(event.name)) runsWithPlan.add(event.runId)
  }
  return events.filter((event) => {
    if (event.type !== 'text' || !runsWithPlan.has(event.runId)) return true
    return !String(event.itemId || '').endsWith(':plan')
  })
}

// Detect only the final reply after a run finishes, never partial streamed text.
export const detectAutomaticPlans = (events, runs) => {
  const completed = new Set(runs.filter((run) => run.status === 'completed').map((run) => run.id))
  const recorded = new Set()
  const lastReply = new Map()
  for (const event of events) {
    if (event.type === 'result' && event.status === 'completed') completed.add(event.runId)
    if (event.type === 'tool_call' && isPlanTool(event.name)) recorded.add(event.runId)
    if (event.type === 'text' && event.text?.trim()) lastReply.set(event.runId, event)
    if (event.type === 'tool_call') lastReply.delete(event.runId)
  }
  return events.map((event) => {
    if (!completed.has(event.runId) || recorded.has(event.runId)
      || lastReply.get(event.runId) !== event || !isMarkdownPlan(event.text)) return event
    return {
      ...event,
      type: 'tool_call',
      automaticPlan: true,
      input: { plan: event.text },
      status: 'completed',
    }
  })
}

export const logParts = (events) => {
  const parts = []
  for (const event of events) {
    if (isBlock(event)) {
      parts.push({ kind: 'block', event })
      continue
    }
    const last = parts[parts.length - 1]
    if (last && last.kind === 'log') last.events.push(event)
    else parts.push({ kind: 'log', events: [event] })
  }
  return parts
}
