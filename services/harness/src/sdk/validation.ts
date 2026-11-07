import type { CoreMode, PhasePipeline, PluginDefinition, PluginManifest, PluginMode, PromptDocument, PromptProvenance, RunOptions, SavedModeDescriptor } from './types'

export const SDK_VERSION = 1 as const
export const CORE_MODES: readonly CoreMode[] = ['agent', 'ask', 'plan']
export const BOOLEAN_MODE_FIELDS = ['terse', 'delegationEligible', 'promptOptional', 'newSession', 'autoName', 'snapshot', 'savePlan', 'steerable'] as const
const ID = /^[a-z0-9][a-z0-9-]*$/
export const validationError = (message: string): Error & { status: number } => Object.assign(new Error(message), { status: 400 })
export const record = (value: unknown, name: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validationError(`${name} must be an object`)
  return value as Record<string, unknown>
}
const string = (value: unknown, name: string, nonempty = false): string => {
  if (typeof value !== 'string' || (nonempty && !value)) throw validationError(`${name} must be ${nonempty ? 'a nonempty' : 'a'} string`)
  return value
}
const id = (value: unknown, name: string): string => {
  const result = string(value, name, true)
  if (!ID.test(result)) throw validationError(`${name} must be a lowercase mode/plugin id`)
  return result
}
export const validatePromptProvenance = (value: unknown): PromptProvenance => {
  const input = record(value, 'promptProvenance')
  if (!Array.isArray(input.sections)) throw validationError('promptProvenance.sections must be an array')
  for (const section of input.sections) {
    const item = record(section, 'prompt section')
    if (!['system', 'user', 'rewritten', 'context'].includes(String(item.kind))) throw validationError('invalid prompt section kind')
    string(item.label, 'prompt section label')
    string(item.text, 'prompt section text')
  }
  for (const key of ['text', 'originalText', 'rewrittenText', 'userItemId']) {
    if (input[key] !== undefined) string(input[key], `promptProvenance.${key}`)
  }
  if (input.messageType !== undefined && input.messageType !== 'user' && input.messageType !== 'agent') throw validationError('invalid promptProvenance.messageType')
  return value as PromptProvenance
}
export const validatePromptDocument = (value: unknown): PromptDocument => {
  const result = validatePromptProvenance(value)
  string(result.text, 'prompt document text')
  return result as PromptDocument
}
export const normalizeRunOptions = (value: unknown = {}): RunOptions => {
  const input = record(value, 'run options')
  const output: RunOptions = {}
  for (const key of ['mode', 'prompt', 'provider', 'model', 'targetMode', 'runAfterSessionId', 'forkRetryKey'] as const) {
    if (input[key] !== undefined) output[key] = input[key] === null ? null : string(input[key], `run options.${key}`)
  }
  if (input.promptProvenance !== undefined) output.promptProvenance = input.promptProvenance === null ? null : validatePromptProvenance(input.promptProvenance)
  return output
}
export const validateManifest = (value: unknown): PluginManifest => {
  const input = record(value, 'plugin manifest')
  id(input.id, 'plugin manifest.id')
  string(input.version, 'plugin manifest.version', true)
  if (input.sdkVersion !== SDK_VERSION) throw validationError(`plugin manifest.sdkVersion must be ${SDK_VERSION}`)
  return value as PluginManifest
}
export const validatePipeline = (value: unknown): PhasePipeline => {
  const input = record(value, 'pipeline')
  const seen = new Set<string>()
  for (const key of ['once', 'eachPhase']) {
    const steps = input[key]
    if (!Array.isArray(steps)) throw validationError(`pipeline.${key} must be an array`)
    for (const value of steps) {
      const step = record(value, 'pipeline step')
      const stepId = string(step.id, 'pipeline step.id', true)
      if (seen.has(stepId)) throw validationError(`duplicate pipeline step: ${stepId}`)
      seen.add(stepId)
      if (!CORE_MODES.includes(step.agentMode as CoreMode)) throw validationError(`${stepId}: invalid agentMode`)
      string(step.promptKey, `${stepId}.promptKey`, true)
      if (step.write !== undefined) string(step.write, `${stepId}.write`, true)
      if (step.parse !== undefined && typeof step.parse !== 'function') throw validationError(`${stepId}.parse must be a function`)
      if (step.outputSchema !== undefined) validateJson(record(step.outputSchema, `${stepId}.outputSchema`), `${stepId}.outputSchema`)
    }
  }
  return value as PhasePipeline
}
const validateJson = (value: unknown, name: string, seen = new Set<object>()): void => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return
  if (typeof value !== 'object' || !value || seen.has(value)) throw validationError(`${name} must contain JSON values`)
  seen.add(value)
  for (const item of Object.values(value)) validateJson(item, name, seen)
  seen.delete(value)
}
const validateBehavior = (input: Record<string, unknown>): void => {
  for (const key of BOOLEAN_MODE_FIELDS) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') throw validationError(`${input.id}: ${key} must be a boolean`)
  }
  if (input.tools !== undefined && (!Array.isArray(input.tools) || input.tools.some(tool => typeof tool !== 'string' || !tool))) throw validationError(`${input.id}: tools must be an array of ids`)
}
export const validateMode = (value: unknown): PluginMode => {
  const input = record(value, 'mode')
  id(input.id, 'mode.id')
  if (input.base !== undefined && !CORE_MODES.includes(input.base as CoreMode)) throw validationError(`${input.id}: base must be one of ${CORE_MODES.join(', ')}`)
  validateBehavior(input)
  for (const key of ['label', 'hint', 'sessionName', 'sendLabel', 'placeholder']) {
    if (input[key] != null) string(input[key], `${input.id}.${key}`)
  }
  if (input.instructions != null && typeof input.instructions !== 'string' && typeof input.instructions !== 'function') throw validationError(`${input.id}: instructions must be a string or function`)
  for (const key of ['buildPrompt', 'onComplete', 'launch']) {
    if (input[key] != null && typeof input[key] !== 'function') throw validationError(`${input.id}: ${key} must be a function`)
  }
  if (input.pipeline !== undefined) validatePipeline(input.pipeline)
  if (input.pipeline && input.launch) throw validationError(`${input.id}: pipeline and launch cannot be combined`)
  return value as PluginMode
}
export const validatePlugin = (value: unknown): PluginDefinition => {
  const input = record(value, 'plugin')
  if (input.manifest !== undefined) validateManifest(input.manifest)
  // Manifestless policy-only plugins predate the SDK.
  if (typeof input.getModes !== 'function' && (input.getModes !== undefined || input.manifest !== undefined)) throw validationError('plugin.getModes must be a function')
  if (input.policy !== undefined && typeof input.policy !== 'function') throw validationError('plugin.policy must be a function')
  return value as PluginDefinition
}
export const definePlugin = <T extends PluginDefinition>(plugin: T): T => {
  validatePlugin(plugin)
  return plugin
}
export const validateSavedDescriptor = (value: unknown): SavedModeDescriptor => {
  const input = record(value, 'saved mode descriptor')
  id(input.id, 'saved mode descriptor.id')
  if (!CORE_MODES.includes(input.base as CoreMode)) throw validationError('saved mode descriptor.base must be a core mode')
  validateBehavior(input)
  if (input.instructions != null) string(input.instructions, 'saved mode descriptor.instructions')
  if (input.kind !== undefined && input.kind !== 'plugin' && input.kind !== 'workflow') throw validationError('invalid saved mode descriptor.kind')
  if (input.manifest !== undefined) validateManifest(input.manifest)
  if (input.options !== undefined) normalizeRunOptions(input.options)
  validateJson(input, 'saved mode descriptor')
  return value as SavedModeDescriptor
}
export const validatePluginManifest = validateManifest
export const validateModeDefinition = validateMode
export const validateSavedModeDescriptor = validateSavedDescriptor
