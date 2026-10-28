const { formatError } = require('../store/formatError')
const builtins = require('./builtins')
const { modeDefaults, normalizeMode } = require('./schema')
const { loadPlugins } = require('./sources')
const rules = require('./rules')
const { log, sessionWorkspace, makeHarnessApi } = require('./harnessApi')

// One registry of modes, tools, and panels, merged from three scopes:
// built-in, then global plugins, then the workspace plugin. Built-in ids are
// reserved. Rules (global registry.json, workspace harness.config.json) and
// plugin `policy(ctx)` hooks decide what is allowed, and every decision
// records what decided it.

const BUILTIN_MODES = builtins.MODES.map((mode) => ({ ...modeDefaults(mode), scope: 'builtin', source: 'builtin' }))
const RESERVED_MODES = new Set(BUILTIN_MODES.map((mode) => mode.id))
const EFFECTS = ['allow', 'deny']

const builtinMode = (id) => BUILTIN_MODES.find((mode) => mode.id === id) || null

// `harness` is the API passed to getModes(); without a workspace there is none.
const resolve = (workspace, { harness } = {}) => {
  const api = harness || (workspace ? makeHarnessApi(workspace) : null)
  const sources = [{ scope: 'builtin', name: 'builtin', file: null, error: null, modes: BUILTIN_MODES.map((mode) => mode.id) }]
  const pluginModes = new Map()
  const policies = []

  for (const plugin of loadPlugins(workspace)) {
    const source = { scope: plugin.scope, name: plugin.name, file: plugin.file, error: plugin.error, modes: [] }
    sources.push(source)
    if (!plugin.exports) continue
    try {
      const { getModes } = plugin.exports
      const list = typeof getModes === 'function' ? getModes(api) : []
      if (!Array.isArray(list)) throw new Error('getModes() must return an array')
      const seen = new Set()
      const entries = list.map((mode) => ({
        ...normalizeMode(mode, { reserved: RESERVED_MODES, seen }),
        scope: plugin.scope,
        source: plugin.name,
        file: plugin.file,
      }))
      for (const entry of entries) {
        const shadowed = pluginModes.get(entry.id)
        pluginModes.set(entry.id, shadowed ? { ...entry, shadows: `${shadowed.scope}:${shadowed.source}` } : entry)
      }
      source.modes = entries.map((entry) => entry.id)
    } catch (err) {
      source.error = formatError(err)
      log(`failed to load modes from ${plugin.file}: ${source.error}`)
    }
    if (typeof plugin.exports.policy === 'function') {
      policies.push({ scope: plugin.scope, name: plugin.name, file: plugin.file, fn: plugin.exports.policy })
    }
  }

  const ruleSets = [rules.readRules(null), ...(workspace ? [rules.readRules(workspace)] : [])]
  return {
    workspace: workspace || null,
    sources,
    ruleSets,
    rules: ruleSets.flatMap((set) => set.rules),
    policies,
    modes: [...BUILTIN_MODES, ...pluginModes.values()],
    tools: builtins.TOOLS.map((tool) => ({ ...tool, scope: 'builtin', source: 'builtin' })),
    panels: builtins.PANELS.map((panel) => ({ ...panel, scope: 'builtin', source: 'builtin' })),
  }
}

const defaultDecision = (resolved, kind, id, mode) => {
  if (kind !== 'tool') return { effect: 'allow', by: 'default', reason: `${kind} is registered` }
  const tool = resolved.tools.find((item) => item.id === id)
  const entry = resolved.modes.find((item) => item.id === mode)
  if (tool?.modes.includes('*')) return { effect: 'allow', by: 'default', reason: `${id} applies to every mode` }
  if (tool?.modes.includes(mode)) return { effect: 'allow', by: 'default', reason: `${id} opts into ${mode}` }
  if (entry?.tools.includes(id)) return { effect: 'allow', by: 'default', reason: `${mode} lists ${id}` }
  return { effect: 'deny', by: 'default', reason: `${id} is not enabled for ${mode}` }
}

// Order: default, then the most specific rule, then plugin policies (global
// before workspace; each sees the decision so far). Policies must be sync.
// `mode` only applies to tool decisions.
const decide = (resolved, { kind, id, mode, provider }) => {
  const ctx = { workspace: resolved.workspace?.id, mode: kind === 'tool' ? mode : undefined, provider: kind === 'panel' ? undefined : provider }
  let decision = defaultDecision(resolved, kind, id, ctx.mode)
  const rule = rules.pickRule(resolved.rules, kind, id, ctx)
  if (rule) {
    decision = {
      effect: rule.effect,
      by: 'rule',
      rule: rule.id,
      scope: rule.scope,
      file: rule.file,
      reason: rule.note || `${rule.effect} by ${rule.scope} rule ${rule.id}`,
    }
  }
  for (const policy of resolved.policies) {
    try {
      const out = policy.fn({ kind, id, workspace: resolved.workspace, mode: ctx.mode, provider: ctx.provider, decision })
      if (out && EFFECTS.includes(out.effect)) {
        decision = {
          effect: out.effect,
          by: 'policy',
          scope: policy.scope,
          source: policy.name,
          file: policy.file,
          reason: typeof out.reason === 'string' && out.reason ? out.reason : `${out.effect} by ${policy.scope} policy ${policy.name}`,
        }
      }
    } catch (err) {
      log(`policy in ${policy.file} failed: ${formatError(err)}`)
    }
  }
  if (decision.effect === 'deny' && builtins.LOCKED[kind].includes(id)) {
    decision = { effect: 'allow', by: 'locked', reason: `${id} cannot be denied`, overridden: decision }
  }
  return decision
}

const withDecision = (resolved, kind, provider) => (entry) =>
  ({ ...entry, decision: decide(resolved, { kind, id: entry.id, provider }) })

const findMode = (workspace, id, { harness, provider } = {}) => {
  const resolved = resolve(workspace, { harness })
  const entry = resolved.modes.find((mode) => mode.id === id)
  return entry ? withDecision(resolved, 'mode', provider)(entry) : null
}

// Throws 400 for unknown modes and 403 for denied ones.
const requireMode = (workspace, id, opts = {}) => {
  const entry = findMode(workspace, id, opts)
  if (!entry) throw Object.assign(new Error(`unknown run mode: ${id}`), { status: 400 })
  if (entry.decision.effect === 'deny') {
    throw Object.assign(new Error(`mode ${id} is not allowed here: ${entry.decision.reason}`), { status: 403 })
  }
  return entry
}

// Allowed tool ids for one turn.
const toolsFor = (workspace, { mode, provider } = {}) => {
  const resolved = resolve(workspace)
  return resolved.tools
    .filter((tool) => decide(resolved, { kind: 'tool', id: tool.id, mode, provider }).effect === 'allow')
    .map((tool) => tool.id)
}

const describeMode = ({ buildPrompt, instructions, onComplete, ...mode }) =>
  ({ ...mode, instructions: typeof instructions === 'string' ? instructions : instructions ? '(function)' : null })

// Allowed modes and panels, as the UI lists them.
const listAllowed = (workspace, { provider } = {}) => {
  const resolved = resolve(workspace)
  const allowed = (kind) => (entry) => withDecision(resolved, kind, provider)(entry)
  return {
    modes: resolved.modes.map(allowed('mode')).filter((mode) => mode.decision.effect === 'allow').map(describeMode),
    panels: resolved.panels.map(allowed('panel')).filter((panel) => panel.decision.effect === 'allow'),
  }
}

// Everything, allowed or not, with a mode × tool matrix and the reason for
// each cell. Backs the Registry panel.
const explain = (workspace, { provider } = {}) => {
  const resolved = resolve(workspace)
  return {
    workspace: workspace ? { id: workspace.id, name: workspace.name, cwd: workspace.cwd } : null,
    provider: provider || null,
    sources: resolved.sources,
    rules: resolved.ruleSets.map(({ scope, file, rules: list, error }) => ({
      scope, file, error, rules: list.map(({ scope: _s, file: _f, ...rule }) => rule),
    })),
    policies: resolved.policies.map(({ scope, name, file }) => ({ scope, name, file })),
    modes: resolved.modes.map(withDecision(resolved, 'mode', provider)).map(describeMode),
    panels: resolved.panels.map(withDecision(resolved, 'panel', provider)),
    tools: resolved.tools.map((tool) => ({
      ...tool,
      byMode: Object.fromEntries(resolved.modes.map((mode) =>
        [mode.id, decide(resolved, { kind: 'tool', id: tool.id, mode: mode.id, provider })])),
    })),
  }
}

module.exports = {
  RESERVED_MODES,
  builtinMode,
  resolve,
  decide,
  findMode,
  requireMode,
  toolsFor,
  listAllowed,
  explain,
  describeMode,
  readRules: rules.readRules,
  writeRules: rules.writeRules,
  sessionWorkspace,
  makeHarnessApi,
}
