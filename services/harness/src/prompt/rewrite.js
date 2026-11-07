const { execFile } = require('child_process')
const path = require('path')
const { TRIGGERS, inScope } = require('./triggers')
const prompts = require('../prompts')
const paths = require('../store/paths')

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

const devIdPaths = async ([match, id], { cwd, provider, model, mode }) => {
  const locations = await findLocations(id, cwd)
  return locations.length ? prompts.render('devIdPaths', { match, files: locations.join(' ') }, provider, { model, mode }) : match
}

const sessionIdPaths = ([match], { provider, model, mode }) => {
  const location = paths.locateSession(match)
  return location ? prompts.render('sessionIdPaths', { match, path: path.resolve(location.dir) }, provider, { model, mode }) : match
}

const trigger = (id) => TRIGGERS.find((item) => item.id === id)

// Applied in order. Patterns need the `g` flag; rewrite(match, context)
// resolves to the replacement text for that match. `trigger` supplies the
// pattern and scope.
const rules = [
  { name: 'devId', trigger: trigger('devIdPaths'), rewrite: devIdPaths },
  { name: 'sessionId', trigger: trigger('sessionIdPaths'), rewrite: sessionIdPaths },
]

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

// context: { cwd, first, provider, model, mode }. `first: false` skips first-prompt-only rules.
const rewritePrompt = async (text, context = {}) => {
  if (typeof text !== 'string' || !text) return text
  let out = text
  for (const { trigger: { patterns }, rewrite } of rules.filter((rule) => inScope(rule.trigger, context))) {
    out = await replaceAsync(out, patterns[0], rewrite, context)
  }
  return out
}

module.exports = { rewritePrompt, rules }
