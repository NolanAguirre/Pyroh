const config = require('../config')
const prompts = require('../prompts')
const { TEMPLATES } = require('../prompts/templates')
const { TRIGGERS, NEGATIVE_TRIGGERS, inScope, hasNegativeTrigger } = require('./triggers')
const overlays = require('../prompts/overlays')

const matchesFor = (text, patterns = []) => patterns.flatMap(pattern => {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  return [...text.matchAll(new RegExp(pattern.source, flags))]
    .filter(match => match[0])
    .map(match => ({ start: match.index, end: match.index + match[0].length }))
})

const condition = ({ id, label, description, target, defaultOn, eligible, patterns }) => ({
  id,
  evaluate: (text, context) => {
    if (!eligible(context)) return null
    const overlay = overlays.resolve(context)
    const trigger = overlay.triggers.get(id)
    if (trigger?.scope && !inScope(trigger, context)) return null
    const selectedPatterns = trigger?.patterns ?? patterns
    const matches = matchesFor(text, selectedPatterns)
    if (selectedPatterns && !matches.length) return null
    if (!overlay.enabled(id)) return {
      id, label, target, defaultOn, effect: 'excluded', description: 'Excluded by a prompt overlay', matches,
    }
    if (!prompts.text(id, context.provider, context)) return null
    const exclusions = NEGATIVE_TRIGGERS.filter(trigger => trigger.id === id && inScope(trigger, context))
    const excluded = trigger?.excludePatterns === undefined ? hasNegativeTrigger(text, id, context)
      : matchesFor(text, trigger.excludePatterns).length > 0
    if (excluded) {
      return {
        id, label, target, defaultOn, effect: 'excluded',
        description: trigger?.excludePatterns ? 'Excluded by a plugin trigger' : exclusions.map(trigger => trigger.description).join(' '),
        matches: trigger?.excludePatterns ? matchesFor(text, trigger.excludePatterns) : exclusions.flatMap(trigger => matchesFor(text, trigger.patterns)),
      }
    }
    return { id, label, description, target, defaultOn, effect: 'applied', matches }
  },
})

// One backend condition list is used for draft feedback and actual sends.
// A condition returns null when it leaves the prompt alone.
const buildConditions = (entries = TEMPLATES, triggers = TRIGGERS) => [
  ...entries.filter(entry => entry.firstMessage).map(entry => condition({
    id: entry.id, label: entry.name, description: entry.description, target: 'first', defaultOn: true,
    eligible: context => context.first === true && (entry.id !== 'terse' || context.terse),
  })),
  ...triggers.filter(trigger => !entries.some(entry => entry.id === trigger.id && entry.firstMessage)).map(trigger => {
    const target = ['devIdPaths', 'sessionIdPaths'].includes(trigger.id) ? 'rewrite' : 'action'
    return condition({
      ...trigger, target, defaultOn: false,
      eligible: context => inScope(trigger, context)
        && (target !== 'action' || !context.textOnly)
        && (trigger.id !== 'devIds' || Boolean(config.devIdMcpUrl && context.workspaceId)),
    })
  }),
]
const conditions = buildConditions()

const evaluateConditions = (text, context = {}) => {
  if (typeof text !== 'string' || !text) return []
  const overlay = overlays.resolve(context)
  const entries = [...overlay.entries.values()]
  const triggers = TRIGGERS.map(trigger => ({ ...trigger, ...overlay.triggers.get(trigger.id) }))
  const extra = [...overlay.triggers].filter(([id]) => !TRIGGERS.some(trigger => trigger.id === id)
    && !overlay.entries.get(id).firstMessage).map(([id, trigger]) => condition({
    id, label: overlay.entries.get(id).name, description: 'Plugin prompt trigger', target: 'prepend', defaultOn: false,
    patterns: trigger.patterns, eligible: context => inScope(trigger, context),
  }))
  return [...buildConditions(entries, triggers), ...extra].map(condition => condition.evaluate(text, context)).filter(Boolean)
}

const highlightsFor = triggered => {
  const matches = triggered.flatMap(({ id, effect, matches }) => matches.map(match => ({ ...match, id, effect })))
    .sort((a, b) => a.start - b.start || b.end - a.end)
  const highlights = []
  for (const match of matches) {
    if (highlights.length && match.start < highlights.at(-1).end) continue
    highlights.push(match)
  }
  return highlights
}

module.exports = { conditions, evaluateConditions, highlightsFor }
