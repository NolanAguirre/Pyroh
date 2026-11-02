import { isPlanTool } from './plan'

// Item IDs belong to a provider turn. Merge replayed deltas exactly as live ones,
// and replace them with the authoritative completed item when it arrives.
export const transcriptItems = (events) => {
  const rows = []
  const byId = new Map()
  for (const event of events) {
    if (event.type === 'usage' || event.type === 'context' || event.type === 'question') continue
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
  return [{ type: 'user', text: run.prompt, runId: run.id, ts: run.startedAt || 0, itemId: `user:${run.id}` }]
})

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
