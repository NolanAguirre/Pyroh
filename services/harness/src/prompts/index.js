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

const text = (id) => get(id).template

const render = (id, vars = {}) =>
  get(id).template.replace(PLACEHOLDER, (_, key) => (vars[key] == null ? '' : String(vars[key])))

const focusBlock = (focus) => (focus ? render('operatorFocus', { focus }) : '')

const directoryLines = (directories) => directories.map((dir) => `- ${JSON.stringify(dir)}`).join('\n')

const list = () => TEMPLATES.map(({ id, name, group, description, usedBy, vars, template }) =>
  ({ id, name, group, description, usedBy, vars, template }))

module.exports = { get, text, render, focusBlock, directoryLines, list }
