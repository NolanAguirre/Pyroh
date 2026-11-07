const registry = require('../../registry')
const runtime = require('../../harness/pipelineDaemon')

const pipeline = () => {
  const definition = registry.builtinMode('decompose')?.pipeline
  if (!definition) throw new Error('decompose: bundled pipeline is unavailable')
  return definition
}

const onceSteps = () => pipeline().once
const eachPhaseSteps = () => pipeline().eachPhase
const nextProgress = (currentPhase, currentStep, totalPhases) =>
  runtime.nextProgress(pipeline(), currentPhase, currentStep, totalPhases)

// Keep the legacy parser entry point backed by the bundled plugin definition.
const parsePhaseCount = (text) => {
  const step = onceSteps().find((item) => typeof item.parse === 'function')
  if (!step) throw new Error('decompose: bundled phase parser is unavailable')
  return runtime.parseStepOutput(step, text)
}

module.exports = {
  get STEPS() {
    return [
      ...onceSteps().map((step) => ({ ...step, when: 'once' })),
      ...eachPhaseSteps().map((step) => ({ ...step, when: 'eachPhase' })),
    ]
  },
  onceSteps,
  eachPhaseSteps,
  promptFor: runtime.promptFor,
  promptForWithProvenance: runtime.promptForWithProvenance,
  parsePhaseCount,
  parseStepOutput: runtime.parseStepOutput,
  nextProgress,
  shouldSkip: runtime.shouldSkip,
}
