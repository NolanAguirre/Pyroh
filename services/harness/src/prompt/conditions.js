const config = require('../config')
const prompts = require('../prompts')
const { TEMPLATES } = require('../prompts/templates')
const { TRIGGERS, NEGATIVE_TRIGGERS, inScope, hasNegativeTrigger } = require('./triggers')

const matchesFor = (text, patterns = []) => patterns.flatMap(pattern => {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  return [...text.matchAll(new RegExp(pattern.source, flags))]
    .filter(match => match[0])
    .map(match => ({ start: match.index, end: match.index + match[0].length }))
})

const condition = ({ id, label, description, target, eligible, patterns }) => ({
  id,
  evaluate: (text, context) => {
    if (!eligible(context) || !prompts.text(id, context.provider, context)) return null
    const matches = matchesFor(text, patterns)
    if (patterns && !matches.length) return null
    const exclusions = NEGATIVE_TRIGGERS.filter(trigger => trigger.id === id && inScope(trigger, context))
    if (hasNegativeTrigger(text, id, context)) {
      return {
        id, label, target, effect: 'excluded',
        description: exclusions.map(trigger => trigger.description).join(' '),
        matches: exclusions.flatMap(trigger => matchesFor(text, trigger.patterns)),
      }
    }
    return { id, label, description, target, effect: 'applied', matches }
  },
})

// One backend condition list is used for draft feedback and actual sends.
// A condition returns null when it leaves the prompt alone.
const conditions = [
  ...TEMPLATES.filter(entry => entry.firstMessage).map(entry => condition({
    id: entry.id, label: entry.name, description: entry.description, target: 'first',
    eligible: context => context.first === true && (entry.id !== 'terse' || context.terse),
  })),
  ...TRIGGERS.map(trigger => {
    const target = ['devIdPaths', 'sessionIdPaths'].includes(trigger.id) ? 'rewrite' : 'action'
    return condition({
      ...trigger, target,
      eligible: context => inScope(trigger, context)
        && (target !== 'action' || !context.textOnly)
        && (trigger.id !== 'devIds' || Boolean(config.devIdMcpUrl && context.workspaceId)),
    })
  }),
]

const evaluateConditions = (text, context = {}) => {
  if (typeof text !== 'string' || !text) return []
  return conditions.map(condition => condition.evaluate(text, context)).filter(Boolean)
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
