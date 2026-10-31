const prompts = require('../../prompts')

const STEPS = [
  {
    id: 'count',
    when: 'once',
    agentMode: 'agent',
    model: 'grok-4.7',
    // Codex and Grok have native plan mode, not Cursor's tools: [] contract.
    providers: {
      codex: { model: null, tools: undefined, agentMode: 'plan', outputSchema: {
        type: 'object', properties: { count: { type: 'integer', minimum: 1 } },
        required: ['count'], additionalProperties: false,
      } },
      grok: { model: null, tools: undefined, agentMode: 'plan' },
      claude: { model: null },
    },
    tools: [],
    promptKey: 'countPhases',
    parse: 'phaseCount',
    write: 'count.json',
  },
  {
    id: 'plan',
    when: 'eachPhase',
    agentMode: 'plan',
    promptKey: 'planPhase',
    write: 'plan.md',
  },
  {
    id: 'execute',
    when: 'eachPhase',
    agentMode: 'agent',
    promptKey: 'executePhase',
  },
]

const onceSteps = () => STEPS.filter((step) => step.when === 'once')

const eachPhaseSteps = () => STEPS.filter((step) => step.when === 'eachPhase')

const promptFor = (step, vars) => prompts.render(step.promptKey, vars)

const parsePhaseCount = (text) => {
  let raw = String(text || '').trim()
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) raw = fence[1].trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('phase count: no JSON object in model output')
  }
  raw = raw.slice(start, end + 1)
  let data
  try {
    data = JSON.parse(raw)
  } catch (err) {
    throw new Error(`phase count: invalid JSON: ${err && err.message}`)
  }
  if (typeof data.count !== 'number' || !Number.isFinite(data.count) || data.count < 1) {
    throw new Error('phase count: count must be a positive number')
  }
  return { count: Math.floor(data.count) }
}

const parsers = { phaseCount: parsePhaseCount }

const parseStepOutput = (step, text) => {
  if (!step.parse) return null
  const parser = parsers[step.parse]
  if (!parser) throw new Error(`decompose: unknown parser ${step.parse}`)
  return parser(text)
}

// Advance currentPhase/currentStep to the next pipeline item after a success.
const nextProgress = (currentPhase, currentStep, totalPhases) => {
  const once = onceSteps()
  const each = eachPhaseSteps()
  if (currentPhase === 0) {
    const idx = once.findIndex((step) => step.id === currentStep)
    if (idx >= 0 && idx < once.length - 1) {
      return { currentPhase: 0, currentStep: once[idx + 1].id }
    }
    if (!each.length) return { currentPhase: totalPhases || 0, currentStep: 'done' }
    return { currentPhase: 1, currentStep: each[0].id }
  }
  const idx = each.findIndex((step) => step.id === currentStep)
  if (idx >= 0 && idx < each.length - 1) {
    return { currentPhase, currentStep: each[idx + 1].id }
  }
  if (currentPhase < totalPhases) {
    return { currentPhase: currentPhase + 1, currentStep: each[0].id }
  }
  return { currentPhase: totalPhases, currentStep: 'done' }
}

const shouldSkip = (resume, currentPhase, currentStep, itemPhase, itemStepId, order) => {
  if (!resume) return false
  if (currentStep === 'done') return true
  if (currentPhase == null && currentStep == null) return false
  if (itemPhase < (currentPhase || 0)) return true
  if (itemPhase > (currentPhase || 0)) return false
  const currentIdx = order.findIndex((step) => step.id === currentStep)
  const itemIdx = order.findIndex((step) => step.id === itemStepId)
  if (currentIdx === -1) return false
  return itemIdx < currentIdx
}

module.exports = {
  STEPS,
  onceSteps,
  eachPhaseSteps,
  promptFor,
  parsePhaseCount,
  parseStepOutput,
  nextProgress,
  shouldSkip,
}
