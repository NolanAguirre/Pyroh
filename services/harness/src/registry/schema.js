const { AGENT_MODES } = require('../agents/modes')

const ID = /^[a-z0-9][a-z0-9_-]*$/
const KINDS = ['mode', 'tool', 'panel']
const WHERE_KEYS = ['workspace', 'mode', 'provider']
const EFFECTS = ['allow', 'deny']

const fail = (message) => Object.assign(new Error(message), { status: 400 })

const optionalString = (value, name) => {
  if (value != null && typeof value !== 'string') throw fail(`${name} must be a string`)
  return value || ''
}

const idList = (value, name) => {
  if (value == null) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item)) {
    throw fail(`${name} must be an array of ids`)
  }
  return [...new Set(value)]
}

// Shared defaults for built-in and plugin modes, so callers read flags from
// the entry instead of keeping their own lists.
const modeDefaults = (mode) => {
  const label = mode.label || mode.id
  const promptOptional = Boolean(mode.promptOptional)
  return {
    hint: '',
    terse: false,
    promptOptional,
    newSession: false,
    autoName: false,
    snapshot: mode.base !== 'ask',
    savePlan: false,
    steerable: true,
    sessionName: null,
    tools: [],
    sendLabel: label,
    placeholder: `${promptOptional ? 'Optional prompt' : 'Prompt'} for ${label}…`,
    instructions: null,
    buildPrompt: null,
    onComplete: null,
    ...mode,
    label,
  }
}

// Plugin modes keep the original harness.plugin.js contract, plus `tools`.
const normalizeMode = (mode, { reserved, seen }) => {
  if (!mode || typeof mode !== 'object') throw new Error('mode must be an object')
  const { id } = mode
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`invalid mode id: ${JSON.stringify(id)}`)
  if (reserved.has(id)) throw new Error(`mode id clashes with a built-in: ${id}`)
  if (seen.has(id)) throw new Error(`duplicate mode id: ${id}`)
  seen.add(id)
  const base = mode.base || 'agent'
  if (!AGENT_MODES.includes(base)) throw new Error(`${id}: base must be one of ${AGENT_MODES.join(', ')}`)
  const instructions = mode.instructions
  if (instructions != null && typeof instructions !== 'string' && typeof instructions !== 'function') {
    throw new Error(`${id}: instructions must be a string or function`)
  }
  for (const key of ['buildPrompt', 'onComplete']) {
    if (mode[key] != null && typeof mode[key] !== 'function') throw new Error(`${id}: ${key} must be a function`)
  }
  for (const key of ['label', 'hint']) {
    if (mode[key] != null && typeof mode[key] !== 'string') throw new Error(`${id}: ${key} must be a string`)
  }
  return modeDefaults({
    id,
    label: mode.label || id,
    hint: mode.hint || '',
    base,
    kind: 'plugin',
    terse: Boolean(mode.terse),
    promptOptional: Boolean(mode.promptOptional),
    newSession: Boolean(mode.newSession),
    savePlan: base === 'plan',
    tools: idList(mode.tools, `${id}: tools`),
    instructions: instructions || null,
    buildPrompt: mode.buildPrompt || ((ctx) => ctx.prompt),
    onComplete: mode.onComplete || null,
  })
}

// Rule: { id?, where: { workspace?, mode?, provider? }, what: { mode|tool|panel: id }, effect, note? }
// `impliedWorkspace` is set for rules read from a workspace's own config.
const normalizeRule = (rule, index, impliedWorkspace = null) => {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) throw fail(`rules[${index}] must be an object`)
  const where = rule.where == null ? {} : rule.where
  if (typeof where !== 'object' || Array.isArray(where)) throw fail(`rules[${index}].where must be an object`)
  for (const key of Object.keys(where)) {
    if (!WHERE_KEYS.includes(key)) throw fail(`rules[${index}].where.${key} is not one of ${WHERE_KEYS.join(', ')}`)
    if (typeof where[key] !== 'string' || !where[key]) throw fail(`rules[${index}].where.${key} must be a string`)
  }
  if (impliedWorkspace && where.workspace && where.workspace !== impliedWorkspace) {
    throw fail(`rules[${index}].where.workspace must be omitted in a workspace config`)
  }
  const what = rule.what
  const whatKeys = what && typeof what === 'object' ? Object.keys(what) : []
  if (whatKeys.length !== 1 || !KINDS.includes(whatKeys[0])) {
    throw fail(`rules[${index}].what must name exactly one of ${KINDS.join(', ')}`)
  }
  const kind = whatKeys[0]
  if (typeof what[kind] !== 'string' || !ID.test(what[kind])) throw fail(`rules[${index}].what.${kind} must be an id`)
  if (!EFFECTS.includes(rule.effect)) throw fail(`rules[${index}].effect must be allow or deny`)
  return {
    id: rule.id == null ? `rule-${index + 1}` : String(rule.id),
    where: { ...where, ...(impliedWorkspace ? { workspace: impliedWorkspace } : {}) },
    what: { [kind]: what[kind] },
    effect: rule.effect,
    note: optionalString(rule.note, `rules[${index}].note`),
  }
}

module.exports = { WHERE_KEYS, modeDefaults, normalizeMode, normalizeRule }
