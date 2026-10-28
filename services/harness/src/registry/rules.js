const fs = require('fs')
const path = require('path')
const config = require('../config')
const { writeJson } = require('../store/jsonFile')
const { formatError } = require('../store/formatError')
const { normalizeRule } = require('./schema')

// Global rules live in the write dir; workspace rules sit next to
// harness.plugin.js so they can be committed with the project.
const GLOBAL_FILE = 'registry.json'
const WORKSPACE_FILE = 'harness.config.json'

const rulesFile = (workspace) => workspace
  ? path.join(path.resolve(workspace.cwd), WORKSPACE_FILE)
  : path.join(config.writeDir, GLOBAL_FILE)

const readFile = (file) => {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch (err) {
    if (err.code === 'ENOENT') return {}
    throw err
  }
}

// Bad files load as no rules plus an error, like broken plugins.
const readRules = (workspace) => {
  const file = rulesFile(workspace)
  const scope = workspace ? 'workspace' : 'global'
  try {
    const data = readFile(file)
    const raw = data.rules == null ? [] : data.rules
    if (!Array.isArray(raw)) throw new Error('rules must be an array')
    const rules = raw.map((rule, index) => ({ ...normalizeRule(rule, index, workspace?.id), scope, file }))
    return { scope, file, rules, error: null }
  } catch (err) {
    return { scope, file, rules: [], error: formatError(err) }
  }
}

// Replaces the rule list, keeping any other keys in the file. Workspace rules
// are stored without `where.workspace`; it is implied.
const writeRules = (workspace, rules) => {
  if (!Array.isArray(rules)) throw Object.assign(new Error('rules must be an array'), { status: 400 })
  const normalized = rules.map((rule, index) => normalizeRule(rule, index, workspace?.id))
  const stored = normalized.map(({ id, where, what, effect, note }) => {
    const { workspace: _implied, ...rest } = where
    return {
      id,
      where: workspace ? rest : where,
      what,
      effect,
      ...(note ? { note } : {}),
    }
  })
  const file = rulesFile(workspace)
  let data
  try {
    data = readFile(file)
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err
    data = {}
  }
  writeJson(file, { ...data, rules: stored })
  return readRules(workspace)
}

const matches = (where, ctx) => Object.entries(where).every(([key, value]) => ctx[key] === value)

// Most specific wins: more `where` keys beats fewer. Deny wins a tie.
const pickRule = (rules, kind, id, ctx) => {
  let best = null
  for (const rule of rules) {
    if (rule.what[kind] !== id || !matches(rule.where, ctx)) continue
    const specificity = Object.keys(rule.where).length
    if (!best || specificity > best.specificity || (specificity === best.specificity && rule.effect === 'deny')) {
      best = { rule, specificity }
    }
  }
  return best?.rule || null
}

module.exports = { GLOBAL_FILE, WORKSPACE_FILE, rulesFile, readRules, writeRules, pickRule }
