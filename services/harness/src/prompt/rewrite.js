const { execFile } = require('child_process')
const path = require('path')
const { TRIGGERS, inScope, hasNegativeTrigger } = require('./triggers')
const prompts = require('../prompts')
const paths = require('../store/paths')
const provenance = require('./provenance')
const { TEMPLATES } = require('../prompts/templates')

const firstMessageTemplates = TEMPLATES.filter(entry => entry.firstMessage)
const prependFirstMessage = (prompt, context, incomingText) => {
  if (context.first !== true) return prompt
  const parts = firstMessageTemplates
    .filter(entry => entry.id !== 'terse' || context.terse)
    .filter(entry => !hasNegativeTrigger(incomingText, entry.id, context))
    .map(entry => provenance.section('system', entry.name, prompts.text(entry.id, context.provider, context)))
    .filter(part => part.text)
  if (context.firstMessageInstructions) {
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

const devIdPaths = async ([match, id], { cwd, provider, model, mode, messageType }) => {
  const locations = await findLocations(id, cwd)
  return locations.length ? prompts.render('devIdPaths', { match, files: locations.join(' ') }, provider, { model, mode, messageType }) : match
}

const sessionIdPaths = ([match], { provider, model, mode, messageType }) => {
  const location = paths.locateSession(match)
  return location ? prompts.render('sessionIdPaths', { match, path: path.resolve(location.dir) }, provider, { model, mode, messageType }) : match
}

const trigger = (id) => TRIGGERS.find((item) => item.id === id)

// Applied in order. Patterns need the `g` flag; rewrite(match, context)
// resolves to the replacement text for that match. `trigger` supplies the
// pattern and scope.
const rules = [
  { name: 'devId', trigger: trigger('devIdPaths'), rewrite: devIdPaths },
  { name: 'sessionId', trigger: trigger('sessionIdPaths'), rewrite: sessionIdPaths },
]
const applicableRules = (context, incomingText) => rules.filter(rule => inScope(rule.trigger, context)
  && !hasNegativeTrigger(incomingText, rule.trigger.id, context)
  && prompts.appliesTo(rule.trigger.id, context.provider, context))

const replaceAsync = async (text, pattern, rewrite, context) => {
  const matches = [...text.matchAll(pattern)]
  if (!matches.length) return text
  const replacements = await Promise.all(matches.map((match) => rewrite(match, context)))
  let out = ''
  let last = 0
  matches.forEach((match, i) => {
    out += text.slice(last, match.index) + replacements[i]
    last = match.index + match[0].length
  })
  return out + text.slice(last)
}

// messageType is the incoming message's source, independent of execution mode.
const rewritePrompt = async (text, context = {}) => {
  if (typeof text !== 'string' || !text) return text
  let out = text
  for (const { trigger: { patterns }, rewrite } of applicableRules(context, text)) {
    out = await replaceAsync(out, patterns[0], rewrite, context)
  }
  return prependFirstMessage(provenance.supplied(out), context, text).text
}

// Use the same full-string matches and replacements as rewritePrompt. Section
// boundaries describe sources; they must never change regex matching behavior.
const rewritePromptWithProvenance = async (prompt, context = {}) => {
  let out = prompt
  context = { messageType: prompt.messageType, ...context }
  for (const { trigger: { patterns }, rewrite } of applicableRules(context, prompt.text)) {
    const matches = [...out.text.matchAll(patterns[0])]
    const replacements = await Promise.all(matches.map(match => rewrite(match, context)))
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
  if (out.sections.some(part => part.kind === 'rewritten')) {
    out.rewrittenText = out.sections.filter(part => ['user', 'rewritten'].includes(part.kind)).map(part => part.text).join('')
  }
  return prependFirstMessage(out, context, prompt.text)
}

module.exports = { rewritePrompt, rewritePromptWithProvenance, rules }
