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

// Existing shared edits keep their flat shape. Provider edits live under
// $providers so old prompts.json files need no migration.
let overrides = null
const loadOverrides = () => {
  if (overrides) return overrides
  let stored = {}
  try {
    stored = readJson(paths.promptsFile(config.writeDir), {}) || {}
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err
  }
  const validEdits = (entries) => Object.fromEntries(Object.entries(entries || {})
    .filter(([id, template]) => byId.has(id) && typeof template === 'string'))
  overrides = { ...validEdits(stored), $providers: Object.fromEntries(
    [...providers.keys()].map((provider) => [provider, validEdits(stored.$providers?.[provider])])) }
  return overrides
}

const defaultText = (id, provider) => {
  const entry = get(id)
  const version = providerEntries(provider)?.get(id)
  if (provider == null) return entry.template
  const shared = loadOverrides()[id] ?? entry.template
  return typeof version === 'function' ? version(shared) : version ?? shared
}
const text = (id, provider) => {
  const fallback = defaultText(id, provider)
  const edits = loadOverrides()
  return (provider == null ? edits[id] : edits.$providers[provider]?.[id]) ?? fallback
}
const render = (id, vars = {}, provider) =>
  text(id, provider).replace(PLACEHOLDER, (_, key) => (vars[key] == null ? '' : String(vars[key])))
const focusBlock = (focus, provider) => (focus ? render('operatorFocus', { focus }, provider) : '')
const directoryLines = (directories) => directories.map((dir) => `- ${JSON.stringify(dir)}`).join('\n')

const describe = ({ id, name, group, description, usedBy, vars, activation, applicableProviders }, provider) => {
  const version = providerEntries(provider)?.get(id)
  const trigger = TRIGGERS.find((item) => item.id === id)
  const edits = loadOverrides()
  const edited = (provider == null ? edits[id] : edits.$providers[provider]?.[id]) != null
  return {
    id, name, group, description, usedBy, vars, provider: provider ?? null,
    applicableProviders: applicableProviders ?? [...providers.keys()],
    activation: trigger ? {
      ...activation, scope: trigger.scope,
      patterns: trigger.patterns.map((pattern) => pattern.toString()),
    } : activation,
    template: text(id, provider), defaultTemplate: defaultText(id, provider),
    edited, builtIn: version != null, customized: provider != null && (version != null || edited),
  }
}
const list = (provider) => {
  providerEntries(provider)
  return TEMPLATES.map((entry) => describe(entry, provider))
}

// Null resets only the selected scope. Shared edits remain inherited unless
// the provider has its own saved edit or built-in version.
const setOverride = (id, template, provider) => {
  if (!byId.has(id)) throw Object.assign(new Error(`prompts: unknown prompt ${id}`), { status: 404 })
  providerEntries(provider)
  const stored = loadOverrides()
  const next = { ...stored, $providers: { ...stored.$providers } }
  if (provider != null) next.$providers[provider] = { ...next.$providers[provider] }
  const target = provider == null ? next : next.$providers[provider]
  if (template == null) {
    delete target[id]
  } else {
    if (typeof template !== 'string') throw badRequest('template must be a string')
    const declared = new Set(get(id).vars.map((item) => item.name))
    const undeclared = placeholders(template).filter((name) => !declared.has(name))
    if (undeclared.length) throw badRequest(`unknown vars ${undeclared.map((name) => `{{${name}}}`).join(', ')}`)
    if (template === defaultText(id, provider)) delete target[id]
    else target[id] = template
  }
  writeJson(paths.promptsFile(config.writeDir), next)
  overrides = next
  return describe(get(id), provider)
}

module.exports = { get, text, render, focusBlock, directoryLines, list, setOverride, registerProvider }
