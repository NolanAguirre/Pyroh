const asObject = (value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value !== 'string' || !value) return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

// Cursor presents a plan with createPlan. Claude exits plan mode with ExitPlanMode.
const PLAN_TOOLS = new Set(['createplan', 'exitplanmode'])
const HARNESS_PLAN_STOP = 'The harness recorded this plan. Stop now without implementing it.'

export const isPlanTool = (name) => PLAN_TOOLS.has(String(name || '').toLowerCase())

export const planMarkdown = (event) => {
  const input = asObject(event.input)
  if (typeof input?.plan === 'string') return input.plan
  const output = asObject(event.output)
  if (typeof output?.plan === 'string') return output.plan
  if (typeof output?.value?.plan === 'string') return output.value.plan
  return ''
}

// Denying ExitPlanMode stops Claude from implementing. That bookkeeping is not a failed plan.
export const planView = (event) => {
  const stopped = event.error === HARNESS_PLAN_STOP || event.output === HARNESS_PLAN_STOP
  if (!stopped) return event
  return { ...event, status: 'completed', error: undefined }
}
