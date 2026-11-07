import type { CoreMode, Effect, ModeBehavior, PluginManifest, PluginMode, RegistryKind } from '../sdk'
import { BOOLEAN_MODE_FIELDS, record, validateMode, validationError } from '../sdk'
import { MODES } from './builtins'

export const WHERE_KEYS = ['workspace', 'mode', 'provider'] as const
const KINDS: RegistryKind[] = ['mode', 'tool', 'panel']
export type Scope = 'builtin' | 'bundled' | 'global' | 'workspace'
export interface ModeEntry extends PluginMode {
  base: CoreMode
  kind: 'turn' | 'plugin' | 'workflow'
  label: string
  tools: string[]
  turnOverrides?: ModeBehavior
  manifest?: PluginManifest
  scope?: Scope
  source?: string
  file?: string | null
  shadows?: string
}
export interface Rule {
  id: string
  where: Partial<Record<typeof WHERE_KEYS[number], string>>
  what: Partial<Record<RegistryKind, string>>
  effect: Effect
  note: string
  scope?: Scope
  file?: string
}
export interface ModeInput extends PluginMode {
  kind?: ModeEntry['kind']
  turnOverrides?: ModeBehavior
  manifest?: PluginManifest
  scope?: Scope
  source?: string
  file?: string | null
  shadows?: string
}
export const modeDefaults = (raw: ModeInput): ModeEntry => {
  const mode = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined)) as unknown as ModeInput
  const primitive = MODES.find(entry => entry.id === mode.base)
  const inherited: ModeBehavior = {}
  for (const key of BOOLEAN_MODE_FIELDS) {
    if (primitive?.[key] !== undefined) inherited[key] = primitive[key]
  }
  if (primitive?.tools !== undefined) inherited.tools = primitive.tools
  if (primitive?.instructions !== undefined) inherited.instructions = primitive.instructions
  const label = mode.label || mode.id
  const promptOptional = Boolean(mode.promptOptional ?? inherited.promptOptional)
  return {
    hint: '', terse: false, delegationEligible: false, promptOptional,
    newSession: false, autoName: false, snapshot: false, savePlan: false, steerable: true,
    sessionName: null, sendLabel: label,
    placeholder: `${promptOptional ? 'Optional prompt' : 'Prompt'} for ${label}…`,
    instructions: null, buildPrompt: null, onComplete: null,
    ...inherited, ...mode,
    base: mode.base || 'agent',
    kind: mode.pipeline ? 'workflow' : mode.kind || 'plugin',
    tools: [...new Set([...(inherited.tools || []), ...(mode.tools || [])])],
    label,
  }
}
export const normalizeMode = (value: unknown, { reserved = new Set<string>(), seen = new Set<string>() } = {}): ModeEntry => {
  const mode = validateMode(value)
  if (reserved.has(mode.id)) throw validationError(`mode id clashes with a reserved mode: ${mode.id}`)
  if (seen.has(mode.id)) throw validationError(`duplicate mode id: ${mode.id}`)
  seen.add(mode.id)
  const turnOverrides: ModeBehavior = {}
  for (const key of BOOLEAN_MODE_FIELDS) if (mode[key] !== undefined) turnOverrides[key] = mode[key]
  if (mode.tools !== undefined) turnOverrides.tools = [...new Set(mode.tools)]
  if (mode.instructions !== undefined) turnOverrides.instructions = mode.instructions
  return modeDefaults({
    ...mode, base: mode.base || 'agent', kind: mode.pipeline ? 'workflow' : 'plugin', turnOverrides,
    tools: [...new Set(mode.tools || [])],
    buildPrompt: mode.buildPrompt || ((ctx) => ctx.prompt),
    onComplete: mode.onComplete || null,
  })
}
export const normalizeRule = (value: unknown, index: number, impliedWorkspace: string | null = null): Rule => {
  const rule = record(value, `rules[${index}]`)
  const where = rule.where == null ? {} : record(rule.where, `rules[${index}].where`)
  for (const [key, value] of Object.entries(where)) {
    if (!(WHERE_KEYS as readonly string[]).includes(key)) throw validationError(`rules[${index}].where.${key} is not one of ${WHERE_KEYS.join(', ')}`)
    if (typeof value !== 'string' || !value) throw validationError(`rules[${index}].where.${key} must be a string`)
  }
  if (impliedWorkspace && where.workspace && where.workspace !== impliedWorkspace) throw validationError(`rules[${index}].where.workspace must be omitted in a workspace config`)
  const what = record(rule.what, `rules[${index}].what`)
  const keys = Object.keys(what)
  const kind = keys[0] as RegistryKind
  if (keys.length !== 1 || !KINDS.includes(kind)) throw validationError(`rules[${index}].what must name exactly one of ${KINDS.join(', ')}`)
  if (typeof what[kind] !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(what[kind])) throw validationError(`rules[${index}].what.${kind} must be an id`)
  if (rule.effect !== 'allow' && rule.effect !== 'deny') throw validationError(`rules[${index}].effect must be allow or deny`)
  if (rule.note != null && typeof rule.note !== 'string') throw validationError(`rules[${index}].note must be a string`)
  return {
    id: rule.id == null ? `rule-${index + 1}` : String(rule.id),
    where: { ...where, ...(impliedWorkspace ? { workspace: impliedWorkspace } : {}) } as Rule['where'],
    what: { [kind]: what[kind] }, effect: rule.effect, note: rule.note || '',
  }
}
