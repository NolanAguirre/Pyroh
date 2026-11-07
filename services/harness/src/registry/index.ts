import type { Decision, HarnessApi, PluginDefinition, RegistryKind, SavedModeDescriptor, Session, Workspace } from '../sdk'
import { validateSavedDescriptor } from '../sdk'
import * as builtins from './builtins'
import { modeDefaults, normalizeMode } from './schema'
import type { ModeEntry, ModeInput, Rule, Scope } from './schema'
import { BUNDLED_PLUGINS, bundledPlugins, loadPlugins } from './sources'

const { formatError }: { formatError(error: unknown): string } = require('../store/formatError')
const { describeProviderModes }: { describeProviderModes(base: string, provider?: string): unknown } = require('../agents/providerModes')
const { describeFlags }: { describeFlags(modes: ModeEntry[]): unknown } = require('./flags')
interface RuleSet { scope: Scope; file: string; rules: Rule[]; error: string | null }
const rules: {
  readRules(workspace: Workspace | null): RuleSet
  writeRules(workspace: Workspace | null, rules: unknown): RuleSet
  pickRule(rules: Rule[], kind: RegistryKind, id: string, ctx: { workspace?: string; mode?: string; provider?: string }): Rule | null
} = require('./rules')
const apiModule: {
  log(message: string): void
  sessionWorkspace(session: Session): Workspace | null
  makeHarnessApi(workspace: Workspace, source?: Session): HarnessApi
} = require('./harnessApi')
export const sessionWorkspace = apiModule.sessionWorkspace
export const makeHarnessApi = apiModule.makeHarnessApi
export const readRules = rules.readRules
export const writeRules = rules.writeRules
const log = apiModule.log

const BUILTIN_MODES: ModeEntry[] = builtins.MODES.map(mode => ({ ...modeDefaults(mode), scope: 'builtin', source: 'builtin' }))
export const RESERVED_MODES = new Set(BUILTIN_MODES.map(mode => mode.id))
interface SourceDescription { scope: Scope; name: string; file: string | null; error: string | null; modes: string[] }
interface Policy { scope: Scope; name: string; file: string | null; fn: NonNullable<PluginDefinition['policy']> }
export interface ResolvedRegistry {
  workspace: Workspace | null
  sources: SourceDescription[]
  ruleSets: RuleSet[]
  rules: Rule[]
  policies: Policy[]
  modes: ModeEntry[]
  tools: (builtins.Tool & { scope: Scope; source: string })[]
  panels: (builtins.Panel & { scope: Scope; source: string })[]
}
interface ResolveOptions { harness?: HarnessApi; provider?: string }

// Historical callers use this lookup for saved specialized modes too. Bundled
// definitions are lazy and API-free at declaration time, avoiding a load cycle.
export const builtinMode = (id: string): ModeEntry | null => {
  const primitive = BUILTIN_MODES.find(mode => mode.id === id)
  if (primitive) return primitive
  for (const plugin of bundledPlugins()) {
    if (!plugin.exports) continue
    try {
      const modes = plugin.exports.getModes(undefined as unknown as HarnessApi)
      if (!Array.isArray(modes)) throw new Error('getModes() must return an array')
      const seen = new Set<string>()
      const entries = modes.map(mode => normalizeMode(mode, { reserved: RESERVED_MODES, seen }))
      const entry = entries.find(mode => mode.id === id)
      if (entry) return { ...entry, manifest: plugin.exports.manifest, scope: 'bundled', source: plugin.name, file: plugin.file }
    } catch (error) { log(`failed to load modes from ${plugin.file}: ${formatError(error)}`) }
  }
  return null
}

export const turnMode = (mode: string | ModeInput | null, plugin?: SavedModeDescriptor | null): ModeEntry | null => {
  if (plugin) {
    const descriptor = validateSavedDescriptor(plugin)
    const current = builtinMode(descriptor.id)
    return modeDefaults({ ...descriptor, kind: descriptor.kind || current?.kind || 'plugin' })
  }
  const entry = typeof mode === 'object' ? mode : builtinMode(mode)
  return entry ? modeDefaults(entry) : null
}
export const turnDescriptor = (entry: ModeEntry, instructions?: string | null): SavedModeDescriptor => {
  const { instructions: _callback, ...overrides } = entry.turnOverrides || {}
  return validateSavedDescriptor({
    id: entry.id, base: entry.base,
    kind: entry.kind === 'workflow' ? 'workflow' : 'plugin',
    ...overrides,
    ...(entry.manifest ? { manifest: { ...entry.manifest } } : {}),
    ...(Object.hasOwn(entry.turnOverrides || {}, 'instructions') ? { instructions: instructions == null ? null : String(instructions) } : {}),
  })
}
// Saved code-dependent work must not silently switch to a different plugin.
// Manifestless descriptors retain the legacy compatibility path.
export const assertCompatiblePlugin = (saved: SavedModeDescriptor | null | undefined, entry: ModeEntry): void => {
  if (!saved?.manifest) return
  const { manifest } = validateSavedDescriptor(saved)
  if (!manifest) return
  if (!entry.manifest || manifest?.id !== entry.manifest.id || manifest.version !== entry.manifest.version || manifest.sdkVersion !== entry.manifest.sdkVersion) {
    throw Object.assign(new Error(`mode ${saved.id} requires plugin ${manifest?.id}@${manifest?.version}`), { status: 409 })
  }
}
export const resolve = (workspace: Workspace | null, { harness }: ResolveOptions = {}): ResolvedRegistry => {
  const api = harness || (workspace ? makeHarnessApi(workspace) : undefined)
  const sources: SourceDescription[] = [{ scope: 'builtin', name: 'builtin', file: null, error: null, modes: BUILTIN_MODES.map(mode => mode.id) }]
  const pluginModes = new Map<string, ModeEntry>()
  const bundledIds = new Set<string>()
  const policies: Policy[] = []
  for (const plugin of loadPlugins(workspace)) {
    const source: SourceDescription = { scope: plugin.scope, name: plugin.name, file: plugin.file, error: plugin.error, modes: [] }
    sources.push(source)
    if (!plugin.exports) continue
    try {
      const list = typeof plugin.exports.getModes === 'function' ? plugin.exports.getModes(api as HarnessApi) : []
      if (!Array.isArray(list)) throw new Error('getModes() must return an array')
      const seen = new Set<string>()
      const reserved = new Set([...RESERVED_MODES, ...bundledIds, ...(plugin.scope === 'bundled' ? [] : BUNDLED_PLUGINS)])
      const entries: ModeEntry[] = list.map(mode => ({
        ...normalizeMode(mode, { reserved, seen }),
        ...(plugin.exports?.manifest ? { manifest: plugin.exports.manifest } : {}),
        scope: plugin.scope, source: plugin.name, file: plugin.file,
      }))
      for (const entry of entries) {
        const shadowed = pluginModes.get(entry.id)
        pluginModes.set(entry.id, shadowed ? { ...entry, shadows: `${shadowed.scope}:${shadowed.source}` } : entry)
        if (plugin.scope === 'bundled') bundledIds.add(entry.id)
      }
      source.modes = entries.map(entry => entry.id)
    } catch (error) {
      source.error = formatError(error)
      log(`failed to load modes from ${plugin.file}: ${source.error}`)
    }
    if (typeof plugin.exports.policy === 'function') policies.push({ scope: plugin.scope, name: plugin.name, file: plugin.file, fn: plugin.exports.policy })
  }
  const ruleSets = [rules.readRules(null), ...(workspace ? [rules.readRules(workspace)] : [])]
  return {
    workspace: workspace || null, sources, ruleSets, rules: ruleSets.flatMap(set => set.rules), policies,
    modes: [...BUILTIN_MODES, ...pluginModes.values()],
    tools: builtins.TOOLS.map(tool => ({ ...tool, scope: 'builtin', source: 'builtin' })),
    panels: builtins.PANELS.map(panel => ({ ...panel, scope: 'builtin', source: 'builtin' })),
  }
}
const defaultDecision = (resolved: ResolvedRegistry, kind: RegistryKind, id: string, mode?: string): Decision => {
  if (kind !== 'tool') return { effect: 'allow', by: 'default', reason: `${kind} is registered` }
  const tool = resolved.tools.find(item => item.id === id)
  const entry = resolved.modes.find(item => item.id === mode)
  if (tool?.modes.includes('*')) return { effect: 'allow', by: 'default', reason: `${id} applies to every mode` }
  if (entry?.base && tool?.modes.includes(entry.base)) return { effect: 'allow', by: 'default', reason: `${id} applies to base mode ${entry.base}` }
  if (mode && tool?.modes.includes(mode)) return { effect: 'allow', by: 'default', reason: `${id} opts into ${mode}` }
  if (entry?.tools.includes(id)) return { effect: 'allow', by: 'default', reason: `${mode} lists ${id}` }
  return { effect: 'deny', by: 'default', reason: `${id} is not enabled for ${mode}` }
}
export const decide = (resolved: ResolvedRegistry, { kind, id, mode, provider }: { kind: RegistryKind; id: string; mode?: string; provider?: string }): Decision => {
  const ctx = { workspace: resolved.workspace?.id, mode: kind === 'tool' ? mode : undefined, provider: kind === 'panel' ? undefined : provider }
  let decision = defaultDecision(resolved, kind, id, ctx.mode)
  const rule = rules.pickRule(resolved.rules, kind, id, ctx)
  if (rule) decision = { effect: rule.effect, by: 'rule', rule: rule.id, scope: rule.scope, file: rule.file, reason: rule.note || `${rule.effect} by ${rule.scope} rule ${rule.id}` }
  for (const policy of resolved.policies) {
    try {
      const out = policy.fn({ kind, id, workspace: resolved.workspace, mode: ctx.mode, provider: ctx.provider, decision })
      if (out && (out.effect === 'allow' || out.effect === 'deny')) {
        decision = { effect: out.effect, by: 'policy', scope: policy.scope, source: policy.name, file: policy.file,
          reason: typeof out.reason === 'string' && out.reason ? out.reason : `${out.effect} by ${policy.scope} policy ${policy.name}` }
      }
    } catch (error) { log(`policy in ${policy.file} failed: ${formatError(error)}`) }
  }
  if (decision.effect === 'deny' && builtins.LOCKED[kind].includes(id)) decision = { effect: 'allow', by: 'locked', reason: `${id} cannot be denied`, overridden: decision }
  return decision
}
const withDecision = (resolved: ResolvedRegistry, kind: RegistryKind, provider?: string) => <T extends { id: string; base?: string }>(entry: T): T & { decision: Decision; providerModes?: unknown } => ({
  ...entry, ...(kind === 'mode' ? { providerModes: describeProviderModes(entry.base || 'agent', provider) } : {}),
  decision: decide(resolved, { kind, id: entry.id, provider }),
})
export const findMode = (workspace: Workspace | null, id: string, { harness, provider }: ResolveOptions = {}) => {
  const resolved = resolve(workspace, { harness })
  const entry = resolved.modes.find(mode => mode.id === id)
  return entry ? withDecision(resolved, 'mode', provider)(entry) : null
}
export const requireMode = (workspace: Workspace | null, id: string, opts: ResolveOptions = {}) => {
  const entry = findMode(workspace, id, opts)
  if (!entry) throw Object.assign(new Error(`unknown run mode: ${id}`), { status: 400 })
  if (entry.decision.effect === 'deny') throw Object.assign(new Error(`mode ${id} is not allowed here: ${entry.decision.reason}`), { status: 403 })
  return entry
}
export const toolsFor = (workspace: Workspace | null, { mode, provider }: { mode?: string; provider?: string } = {}): string[] => {
  const resolved = resolve(workspace)
  return resolved.tools.filter(tool => decide(resolved, { kind: 'tool', id: tool.id, mode, provider }).effect === 'allow').map(tool => tool.id)
}
// Recursion also removes pipeline parsers and future nested callbacks.
const withoutFunctions = (value: unknown): unknown => {
  if (typeof value === 'function' || value === undefined) return undefined
  if (Array.isArray(value)) return value.map(withoutFunctions).filter(item => item !== undefined)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item !== 'function' && item !== undefined).map(([key, item]) => [key, withoutFunctions(item)]))
  return value
}
export const describeMode = (entry: ModeEntry): unknown => {
  const { buildPrompt: _build, instructions, onComplete: _complete, launch: _launch, turnOverrides: _overrides, ...mode } = entry
  return withoutFunctions({ ...mode, instructions: typeof instructions === 'string' ? instructions : instructions ? '(function)' : null })
}
export const listAllowed = (workspace: Workspace | null, { provider }: ResolveOptions = {}) => {
  const resolved = resolve(workspace)
  return {
    modes: resolved.modes.map(withDecision(resolved, 'mode', provider)).filter(mode => mode.decision.effect === 'allow').map(describeMode),
    panels: resolved.panels.map(withDecision(resolved, 'panel', provider)).filter(panel => panel.decision.effect === 'allow'),
  }
}
export const explain = (workspace: Workspace | null, { provider }: ResolveOptions = {}) => {
  const resolved = resolve(workspace)
  return {
    workspace: workspace ? { id: workspace.id, name: workspace.name, cwd: workspace.cwd } : null,
    provider: provider || null, sources: resolved.sources,
    rules: resolved.ruleSets.map(({ scope, file, rules: list, error }) => ({ scope, file, error,
      rules: list.map(({ scope: _scope, file: _file, ...rule }) => rule) })),
    policies: resolved.policies.map(({ scope, name, file }) => ({ scope, name, file })),
    modes: resolved.modes.map(withDecision(resolved, 'mode', provider)).map(describeMode),
    flags: describeFlags(resolved.modes), panels: resolved.panels.map(withDecision(resolved, 'panel', provider)),
    tools: resolved.tools.map(tool => ({ ...tool, byMode: Object.fromEntries(resolved.modes.map(mode =>
      [mode.id, decide(resolved, { kind: 'tool', id: tool.id, mode: mode.id, provider })])) })),
  }
}
