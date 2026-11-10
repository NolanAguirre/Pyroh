const { execFile } = require('child_process')
const path = require('path')
const { TRIGGERS } = require('./triggers')
const { evaluateConditions, highlightsFor } = require('./conditions')
const prompts = require('../prompts')
const paths = require('../store/paths')
const provenance = require('./provenance')
const overlays = require('../prompts/overlays')
const prependFirstMessage = (prompt, context, triggered) => {
  const parts = triggered
    .filter(entry => (entry.target === 'prepend' || (entry.target === 'first' && context.first === true)) && entry.effect === 'applied')
    .map(entry => provenance.section('system', entry.label, prompts.text(entry.id, context.provider, context)))
    .filter(part => part.text)
  if (context.first === true && context.firstMessageInstructions) {
    parts.push(provenance.section('system', 'Delegation instructions', context.firstMessageInstructions))
  }
  return provenance.prepend(parts, prompt)
}

// --null puts a NUL after the path so paths containing ':' still parse.
const findLocations = (needle, cwd) => new Promise((resolve) => {
  if (!cwd) return resolve([])
  execFile(
    'rg',
    ['--line-number', '--with-filename', '--no-heading', '--null', '--sort', 'path',
      '--fixed-strings', '--word-regexp', '--follow', '--', needle, cwd],
    { maxBuffer: 1024 * 1024 },
    (err, stdout) => resolve(String(stdout || '').split('\n').filter(Boolean).map((row) => {
      const [path, rest = ''] = row.split('\0')
      return `${path}:${rest.split(':')[0]}`
    }))
  )
})

const devIdPaths = async ([match, id], context) => {
  const locations = await findLocations(id, context.cwd)
  return locations.length ? prompts.render('devIdPaths', { match, files: locations.join(' ') }, context.provider, context) : match
}

const sessionIdPaths = ([match], context) => {
  const location = paths.locateSession(match)
  return location ? prompts.render('sessionIdPaths', { match, path: path.resolve(location.dir) }, context.provider, context) : match
}

const trigger = (id) => TRIGGERS.find((item) => item.id === id)

// Applied in order. Patterns need the `g` flag; rewrite(match, context)
// resolves to the replacement text for that match. `trigger` supplies the
// pattern and scope.
const rules = [
  { name: 'devId', trigger: trigger('devIdPaths'), rewrite: devIdPaths },
  { name: 'sessionId', trigger: trigger('sessionIdPaths'), rewrite: sessionIdPaths },
]
const applicableRules = triggered => rules.filter(rule => triggered.some(entry =>
  entry.id === rule.trigger.id && entry.effect === 'applied'))

// messageType is the incoming message's source, independent of execution mode.
const rewritePrompt = async (text, context = {}) => {
  if (typeof text !== 'string' || !text) return text
  return (await rewritePromptWithProvenance(provenance.supplied(text), context)).text
}

// Use the same full-string matches and replacements as rewritePrompt. Section
// boundaries describe sources; they must never change regex matching behavior.
const evaluatePrompt = async (prompt, context = {}) => {
  let out = prompt
  context = { messageType: prompt.messageType, ...context }
  const overlay = overlays.resolve(context)
  let triggered = evaluateConditions(out.text, context)
  for (const { trigger: { id, patterns }, rewrite } of applicableRules(triggered)) {
    const selectedPatterns = overlay.triggers.get(id)?.patterns ?? patterns
    const candidates = selectedPatterns.flatMap(pattern => [...out.text.matchAll(new RegExp(pattern.source,
      pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))]).filter(match => match[0])
      .sort((a, b) => a.index - b.index || b[0].length - a[0].length)
    const matches = []
    for (const match of candidates) if (!matches.length || match.index >= matches.at(-1).index + matches.at(-1)[0].length) matches.push(match)
    const replacements = await Promise.all(matches.map(match => rewrite(match, context)))
    if (!matches.some((match, index) => replacements[index] !== match[0])) {
      triggered = triggered.filter(entry => entry.id !== id)
      continue
    }
    triggered = triggered.map(entry => entry.id === id ? {
      ...entry,
      matches: entry.matches.filter((_, index) => matches[index] && replacements[index] !== matches[index][0]),
    } : entry)
    const parts = []
    let last = 0
    matches.forEach((match, index) => {
      parts.push(...provenance.slice(out, last, match.index))
      const end = match.index + match[0].length
      const source = provenance.slice(out, match.index, end)
      if (replacements[index] === match[0]) parts.push(...source)
      else {
        const user = source.every(part => ['user', 'rewritten'].includes(part.kind))
        const kind = user ? 'rewritten' : source.every(part => part.kind === 'system') ? 'system' : 'context'
        parts.push(provenance.section(kind, user ? 'Rewritten user text' : 'Rewritten supplied context', replacements[index]))
      }
      last = end
    })
    parts.push(...provenance.slice(out, last, out.text.length))
    out = provenance.assemble(parts, out)
  }
  for (const rewrite of overlay.rewrites) {
    const value = await rewrite(out, overlay.context)
    require('../sdk').validatePromptDocument(value)
    out = provenance.supplied(value.text, { ...out, ...value })
  }
  if (out.sections.some(part => part.kind === 'rewritten')) {
    out.rewrittenText = out.sections.filter(part => ['user', 'rewritten'].includes(part.kind)).map(part => part.text).join('')
  }
  return { prompt: prependFirstMessage(out, context, triggered), triggered, highlights: highlightsFor(triggered) }
}

const rewritePromptWithProvenance = async (prompt, context = {}) => (await evaluatePrompt(prompt, context)).prompt

module.exports = { rewritePrompt, rewritePromptWithProvenance, evaluatePrompt, rules }
