const { execFile } = require('child_process')
const { TRIGGERS } = require('./triggers')
const prompts = require('../prompts')

const findFiles = (needle, cwd) => new Promise((resolve) => {
  if (!cwd) return resolve([])
  execFile(
    'rg',
    ['--files-with-matches', '--fixed-strings', '--word-regexp', '--follow', '--', needle, cwd],
    { maxBuffer: 1024 * 1024 },
    (err, stdout) => resolve(String(stdout || '').split('\n').filter(Boolean).sort())
  )
})

const devIdPaths = async ([match, id], { cwd }) => {
  const files = await findFiles(id, cwd)
  return files.length ? prompts.render('devIdPaths', { match, files: files.join(' ') }) : match
}

const triggerPattern = (id) => TRIGGERS.find((trigger) => trigger.id === id).patterns[0]

// Applied in order. Patterns need the `g` flag; rewrite(match, context)
// resolves to the replacement text for that match.
const rules = [
  { name: 'devId', pattern: triggerPattern('devIdPaths'), rewrite: devIdPaths },
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

const rewritePrompt = async (text, context = {}) => {
  if (typeof text !== 'string' || !text) return text
  let out = text
  for (const { pattern, rewrite } of rules) {
    out = await replaceAsync(out, pattern, rewrite, context)
  }
  return out
}

module.exports = { rewritePrompt, rules }
