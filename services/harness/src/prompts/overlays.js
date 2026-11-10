const path = require('path')
const config = require('../config')
const { TEMPLATES } = require('./templates')

const cache = new WeakMap()
const resolve = (context = {}, provider = context.provider) => {
  const cached = cache.get(context)
  if (cached?.has(provider)) return cached.get(provider)
  // Load lazily: plugins can import the SDK and prompt helpers themselves.
  const { loadPlugins } = require('../registry/sources')
  const { validatePromptOverlay } = require('../sdk')
  const store = require('../store/workspaceStore')
  const workspace = context.workspace
    || (context.workspaceId ? store.loadWorkspace(context.workspaceId, config.writeDir) : null)
    || (context.cwd ? { id: context.cwd, cwd: context.cwd, name: path.basename(context.cwd) } : null)
  const pluginContext = { ...context, provider, workspace }
  const entries = new Map(TEMPLATES.map(entry => [entry.id, { ...entry }]))
  const edits = new Map()
  const sources = new Map()
  const triggers = new Map()
  const layers = []
  const rewrites = []
  for (const plugin of loadPlugins(workspace)) {
    if (plugin.error) throw new Error(`prompt plugin ${plugin.file}: ${plugin.error}`)
    if (!plugin.exports) continue
    for (const value of [plugin.exports.prompts, plugin.exports.getPrompts?.(pluginContext)]) {
      if (value == null) continue
      const layer = validatePromptOverlay(value)
      layers.push(layer)
      for (const [id, value] of Object.entries(layer.templates || {})) {
        const edit = typeof value === 'string' ? { template: value } : value
        const previous = entries.get(id)
        if (!previous && edit.template === undefined) throw new Error(`prompt ${id} requires a template`)
        const entry = { id, name: id, group: 'plugins', description: 'Plugin prompt', usedBy: [plugin.file], vars: [],
          ...previous, ...edit }
        const variables = [...entry.template.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1])
        if (previous && variables.some(name => !previous.vars.some(variable => variable.name === name))) throw new Error(`prompt ${id} uses undeclared variables`)
        if (!previous) entry.vars = [...new Set(variables)].map(name => ({ name, description: name }))
        entries.set(id, entry)
        edits.set(id, { ...edits.get(id), ...edit })
        sources.set(id, plugin.file)
      }
      for (const [id, trigger] of Object.entries(layer.triggers || {})) triggers.set(id, { ...triggers.get(id), ...trigger })
      if (layer.rewritePrompt) rewrites.push(layer.rewritePrompt)
    }
  }
  let included = null
  const excluded = new Set()
  for (const layer of layers) {
    for (const id of [...(layer.include || []), ...(layer.exclude || []), ...Object.keys(layer.triggers || {})]) {
      if (!entries.has(id)) throw new Error(`prompt overlay references unknown prompt: ${id}`)
    }
    if (layer.include) {
      included = new Set(layer.include)
      excluded.clear()
    }
    for (const id of layer.exclude || []) excluded.add(id)
  }
  const result = { entries, edits, sources, triggers, rewrites, context: pluginContext,
    enabled: id => (!included || included.has(id)) && !excluded.has(id) }
  const values = cached || new Map()
  values.set(provider, result)
  cache.set(context, values)
  return result
}

module.exports = { resolve }
