// Finds the words the dictionary pass may check. Everything that looks like
// code, a name or an identifier is skipped rather than risking a bad "fix".

const CONTEXT_WORDS = 5

// Regions skipped whole: fenced blocks, inline code, URLs and @mentions.
const SKIP_PATTERNS = [
  /```[\s\S]*?(?:```|$)/g,
  /`[^`\n]*`/g,
  /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi,
  /\bwww\.\S+/gi,
  /@\S+/g,
]

const PLAIN_WORD = /^[A-Za-z]+(?:'[A-Za-z]+)*$/
const CAMEL = /[a-z][A-Z]/
const EDGE_PUNCTUATION = /^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g

const skipRanges = (text, triggers) => {
  const ranges = []
  for (const pattern of SKIP_PATTERNS) {
    for (const match of text.matchAll(pattern)) ranges.push([match.index, match.index + match[0].length])
  }
  for (const span of triggers || []) {
    if (Number.isInteger(span?.start) && Number.isInteger(span?.end)) ranges.push([span.start, span.end])
  }
  return ranges
}

const overlaps = (ranges, start, end) => ranges.some(([a, b]) => start < b && end > a)

// Paths, file.ext, snake_case, kebab-case and anything with a digit keep
// their punctuation inside the token, so the plain-word test rejects them.
const isCheckable = (word, token) => {
  if (!PLAIN_WORD.test(word)) return false
  if (word !== token && /[/\\]/.test(token)) return false
  if (CAMEL.test(word)) return false
  if (word.length > 1 && word === word.toUpperCase()) return false
  return true
}

// Every whitespace token with its offset, so context can be read around a word.
const tokenize = (text) => [...text.matchAll(/\S+/g)].map((m) => ({ text: m[0], start: m.index }))

const findCandidates = (text, { triggers, ignore }) => {
  const ranges = skipRanges(text, triggers)
  const ignored = new Set((ignore || []).map((w) => String(w).toLowerCase()))
  const tokens = tokenize(text)
  const candidates = []
  tokens.forEach((token, index) => {
    const normalized = token.text.replace(/’/g, "'")
    const word = normalized.replace(EDGE_PUNCTUATION, '')
    if (!word) return
    const start = token.start + normalized.indexOf(word)
    const end = start + word.length
    if (overlaps(ranges, token.start, token.start + token.text.length)) return
    if (!isCheckable(word, normalized)) return
    if (ignored.has(word.toLowerCase())) return
    candidates.push({
      word: text.slice(start, end),
      check: word,
      start,
      end,
      before: tokens.slice(Math.max(0, index - CONTEXT_WORDS), index).map((t) => t.text).join(' '),
      after: tokens.slice(index + 1, index + 1 + CONTEXT_WORDS).map((t) => t.text).join(' '),
    })
  })
  return candidates
}

// Carry the original's capitalization over to the replacement.
const matchCase = (original, replacement) => {
  if (original.length > 1 && original === original.toUpperCase()) return replacement.toUpperCase()
  if (original[0] === original[0].toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1)
  return replacement
}

module.exports = { findCandidates, matchCase }
