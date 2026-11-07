const config = require('../config')
const paths = require('../store/paths')
const { readJson, writeJson } = require('../store/jsonFile')
const { TEMPLATES } = require('./templates')
const { listProviders } = require('../agents/driver')
const { PROVIDER_VERSIONS } = require('./providers')
const { TRIGGERS } = require('../prompt/triggers')

const PLACEHOLDER = /\{\{(\w+)\}\}/g
const placeholders = (template) => [...new Set([...template.matchAll(PLACEHOLDER)].map((match) => match[1]))]
const badRequest = (message) => Object.assign(new Error(message), { status: 400 })
const byId = new Map()
for (const entry of TEMPLATES) {
  if (byId.has(entry.id)) throw new Error(`prompts: duplicate id ${entry.id}`)
  const declared = new Set(entry.vars.map((item) => item.name))
  const used = placeholders(entry.template)
  const undeclared = used.filter((name) => !declared.has(name))
  if (undeclared.length) throw new Error(`prompts: ${entry.id} uses undeclared vars ${undeclared.join(', ')}`)
  const unused = [...declared].filter((name) => !used.includes(name))
  if (unused.length) throw new Error(`prompts: ${entry.id} declares unused vars ${unused.join(', ')}`)
  byId.set(entry.id, entry)
}

const get = (id) => {
  const entry = byId.get(id)
  if (!entry) throw new Error(`prompts: unknown prompt ${id}`)
  return entry
}

// Every provider registers every prompt. Versions change text only; trigger
// matching, scope, and actions stay shared.
const providers = new Map()
const registerProvider = (provider, versions = {}) => {
  if (providers.has(provider)) throw new Error(`prompts: duplicate provider ${provider}`)
  for (const id of Object.keys(versions)) get(id)
  providers.set(provider, new Map(TEMPLATES.map(({ id }) => [id, versions[id] ?? null])))
}
for (const provider of listProviders()) registerProvider(provider, PROVIDER_VERSIONS[provider])

const providerEntries = (provider) => {
  if (provider == null) return null
  const entries = providers.get(provider)
  if (!entries) throw badRequest(`prompts: unknown provider ${provider}`)
  return entries
}

const isRecord = (value) => value != null && typeof value === 'object' && !Array.isArray(value)
const validModel = (model) => typeof model === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(model)
  && !['constructor', 'prototype'].includes(model)
const validMode = (mode) => typeof mode === 'string' && /^[a-z0-9][a-z0-9_-]*$/.test(mode)
  && !['constructor', 'prototype'].includes(mode)
const validateScope = ({ model, mode } = {}) => {
  if (model != null && !validModel(model)) throw badRequest('model must be a model id')
  if (mode != null && !validMode(mode)) throw badRequest('mode must be a mode id')
  if (mode != null && model == null) throw badRequest('mode requires a model')
}
const own = (entries, key) => entries && Object.hasOwn(entries, key) ? entries[key] : undefined
const validEdits = (entries) => Object.fromEntries(Object.entries(isRecord(entries) ? entries : {})
  .filter(([id, template]) => byId.has(id) && typeof template === 'string'))

// Keep existing flat shared edits and $providers. Model edits are keyed by
// model id across providers, with optional overrides for each logical mode.
let overrides = null
const loadOverrides = () => {
  if (overrides) return overrides
  let stored = {}
  try {
    stored = readJson(paths.promptsFile(config.writeDir), {}) || {}
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err
  }
  overrides = {
    ...validEdits(stored),
    $providers: Object.fromEntries([...providers.keys()]
      .map((provider) => [provider, validEdits(stored.$providers?.[provider])])),
    $models: Object.fromEntries(Object.entries(isRecord(stored.$models) ? stored.$models : {})
      .filter(([model, entry]) => validModel(model) && isRecord(entry))
      .map(([model, entry]) => [model, {
        prompts: validEdits(entry.prompts),
        modes: Object.fromEntries(Object.entries(isRecord(entry.modes) ? entry.modes : {})
          .filter(([mode]) => validMode(mode))
          .map(([mode, edits]) => [mode, validEdits(edits)])),
      }])),
  }
  return overrides
}

const providerDefaultText = (id, provider) => {
  const entry = get(id)
  const version = providerEntries(provider)?.get(id)
  if (provider == null) return entry.template
  const shared = loadOverrides()[id] ?? entry.template
  return typeof version === 'function' ? version(shared) : version ?? shared
}
const providerText = (id, provider) => {
  const fallback = providerDefaultText(id, provider)
  const edits = loadOverrides()
  return (provider == null ? edits[id] : edits.$providers[provider]?.[id]) ?? fallback
}
const modelEdits = (model) => own(loadOverrides().$models, model)
const selectedEdit = (id, provider, { model, mode } = {}) => {
  if (model != null) {
    const entry = modelEdits(model)
    return (mode == null ? entry?.prompts : own(entry?.modes, mode))?.[id]
  }
  const edits = loadOverrides()
  return provider == null ? edits[id] : edits.$providers[provider]?.[id]
}
const defaultText = (id, provider, { model, mode } = {}) => {
  if (model == null) return providerDefaultText(id, provider)
  const inherited = providerText(id, provider)
  return mode == null ? inherited : modelEdits(model)?.prompts?.[id] ?? inherited
}
const text = (id, provider, context = {}) =>
  selectedEdit(id, provider, context) ?? defaultText(id, provider, context)
const render = (id, vars = {}, provider, context = {}) =>
  text(id, provider, context).replace(PLACEHOLDER, (_, key) => (vars[key] == null ? '' : String(vars[key])))
const focusBlock = (focus, provider, context = {}) => (focus ? render('operatorFocus', { focus }, provider, context) : '')
const directoryLines = (directories) => directories.map((dir) => `- ${JSON.stringify(dir)}`).join('\n')

const describe = ({ id, name, group, description, usedBy, vars, activation, applicableProviders }, provider, context = {}) => {
  const version = providerEntries(provider)?.get(id)
  const trigger = TRIGGERS.find((item) => item.id === id)
  const { model = null, mode = null } = context
  const edited = selectedEdit(id, provider, context) != null
  const inheritedModelEdit = model != null && mode != null && modelEdits(model)?.prompts?.[id] != null
  return {
    id, name, group, description, usedBy, vars, provider: provider ?? null, model, mode,
    applicableProviders: applicableProviders ?? [...providers.keys()],
    activation: trigger ? {
      ...activation, scope: trigger.scope,
      patterns: trigger.patterns.map((pattern) => pattern.toString()),
    } : activation,
    template: text(id, provider, context), defaultTemplate: defaultText(id, provider, context),
    edited, builtIn: model == null && version != null,
    customized: model != null ? edited || inheritedModelEdit : provider != null && (version != null || edited),
  }
}
const list = (provider, context = {}) => {
  providerEntries(provider)
  validateScope(context)
  return TEMPLATES.map((entry) => describe(entry, provider, context))
}

// Null resets only the selected scope. A model edit replaces inherited text;
// saving the inherited text still pins it across providers and later edits.
const setOverride = (id, template, provider, context = {}) => {
  if (!byId.has(id)) throw Object.assign(new Error(`prompts: unknown prompt ${id}`), { status: 404 })
  providerEntries(provider)
  validateScope(context)
  const { model, mode } = context
  const stored = loadOverrides()
  const next = { ...stored, $providers: { ...stored.$providers }, $models: { ...stored.$models } }
  if (provider != null) next.$providers[provider] = { ...next.$providers[provider] }
  let target = provider == null ? next : next.$providers[provider]
  if (model != null) {
    const previous = modelEdits(model)
    const entry = { prompts: { ...previous?.prompts }, modes: { ...previous?.modes } }
    next.$models[model] = entry
    if (mode != null) entry.modes[mode] = { ...own(entry.modes, mode) }
    target = mode == null ? entry.prompts : entry.modes[mode]
  }
  if (template == null) {
    delete target[id]
  } else {
    if (typeof template !== 'string') throw badRequest('template must be a string')
    const declared = new Set(get(id).vars.map((item) => item.name))
    const undeclared = placeholders(template).filter((name) => !declared.has(name))
    if (undeclared.length) throw badRequest(`unknown vars ${undeclared.map((name) => `{{${name}}}`).join(', ')}`)
    if (model == null && template === defaultText(id, provider)) delete target[id]
    else target[id] = template
  }
  if (model != null) {
    const entry = next.$models[model]
    if (mode != null && !Object.keys(entry.modes[mode]).length) delete entry.modes[mode]
    if (!Object.keys(entry.prompts).length && !Object.keys(entry.modes).length) delete next.$models[model]
  }
  writeJson(paths.promptsFile(config.writeDir), next)
  overrides = next
  return describe(get(id), provider, context)
}

const modelScopes = (catalog = {}) => {
  const entries = new Map()
  for (const provider of providers.keys()) {
    for (const model of Array.isArray(catalog[provider]) ? catalog[provider] : []) {
      if (!validModel(model.id)) continue
      if (!entries.has(model.id)) entries.set(model.id, { id: model.id, providers: [] })
      const entry = entries.get(model.id)
      if (!entry.providers.includes(provider)) entry.providers.push(provider)
    }
  }
  for (const id of Object.keys(loadOverrides().$models)) {
    if (!entries.has(id)) entries.set(id, { id, providers: [] })
  }
  return [...entries.values()].sort((a, b) => a.id.localeCompare(b.id))
}
const savedModes = () => [...new Set(Object.values(loadOverrides().$models).flatMap((entry) => Object.keys(entry.modes)))]

module.exports = { get, text, render, focusBlock, directoryLines, list, setOverride, registerProvider, modelScopes, savedModes }
