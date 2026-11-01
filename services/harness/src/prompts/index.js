const config = require('../config')
const paths = require('../store/paths')
const { readJson, writeJson } = require('../store/jsonFile')
const { TEMPLATES } = require('./templates')

const PLACEHOLDER = /\{\{(\w+)\}\}/g

const placeholders = (template) => [...new Set([...template.matchAll(PLACEHOLDER)].map((match) => match[1]))]

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

// Operator edits, stored as `{ [id]: template }` in prompts.json. Loaded once
// and kept in memory; writes go through `setOverride`.
let overrides = null

const loadOverrides = () => {
  if (overrides) return overrides
  let stored = {}
  try {
    stored = readJson(paths.promptsFile(config.writeDir), {}) || {}
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err
  }
  overrides = Object.fromEntries(Object.entries(stored)
    .filter(([id, template]) => byId.has(id) && typeof template === 'string'))
  return overrides
}

const badRequest = (message) => Object.assign(new Error(message), { status: 400 })

// Saves an edited template, or resets to the built-in one when `template` is null.
const setOverride = (id, template) => {
  if (!byId.has(id)) throw Object.assign(new Error(`prompts: unknown prompt ${id}`), { status: 404 })
  const next = { ...loadOverrides() }
  if (template == null) {
    delete next[id]
  } else {
    if (typeof template !== 'string') throw badRequest('template must be a string')
    const declared = new Set(byId.get(id).vars.map((item) => item.name))
    const undeclared = placeholders(template).filter((name) => !declared.has(name))
    if (undeclared.length) throw badRequest(`unknown vars ${undeclared.map((name) => `{{${name}}}`).join(', ')}`)
    if (template === byId.get(id).template) delete next[id]
    else next[id] = template
  }
  writeJson(paths.promptsFile(config.writeDir), next)
  overrides = next
  return describe(byId.get(id))
}

const text = (id) => {
  const entry = get(id)
  const edited = loadOverrides()[id]
  return edited == null ? entry.template : edited
}

const render = (id, vars = {}) =>
  text(id).replace(PLACEHOLDER, (_, key) => (vars[key] == null ? '' : String(vars[key])))

const focusBlock = (focus) => (focus ? render('operatorFocus', { focus }) : '')

const directoryLines = (directories) => directories.map((dir) => `- ${JSON.stringify(dir)}`).join('\n')

const describe = ({ id, name, group, description, usedBy, vars, template }) => {
  const edited = loadOverrides()[id]
  return {
    id, name, group, description, usedBy, vars,
    template: edited == null ? template : edited,
    defaultTemplate: template,
    edited: edited != null,
  }
}

const list = () => TEMPLATES.map(describe)

module.exports = { get, text, render, focusBlock, directoryLines, list, setOverride }
