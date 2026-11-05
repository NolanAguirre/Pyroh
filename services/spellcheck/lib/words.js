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

// Leave contractions that are also ordinary words (its, well, were, ill,
// lets, shell, etc.) alone. These replacements do not need sentence context.
const CONTRACTIONS = new Map(Object.entries({
  dont: "don't", doesnt: "doesn't", didnt: "didn't",
  isnt: "isn't", arent: "aren't", wasnt: "wasn't", werent: "weren't",
  havent: "haven't", hasnt: "hasn't", hadnt: "hadn't",
  couldnt: "couldn't", wouldnt: "wouldn't", shouldnt: "shouldn't",
  mustnt: "mustn't", neednt: "needn't", mightnt: "mightn't",
  im: "I'm", ive: "I've", youre: "you're", youve: "you've", youll: "you'll",
  theyre: "they're", theyve: "they've", theyll: "they'll", weve: "we've",
  thats: "that's", theres: "there's", whats: "what's", wheres: "where's",
}))

const SENTENCE_STARTS = new Set([
  'We', 'He', 'She', 'They', 'This', 'That', 'These', 'Those',
  'The', 'But', 'And', 'However', 'Please', 'Thanks', 'What', 'Why',
  'When', 'Where', 'Who', 'Your', 'Our', 'Their', 'There',
])

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'rev', 'hon', 'sr', 'jr', 'st', 'mt',
  'vs', 'etc', 'eg', 'ie', 'fig', 'eq', 'no', 'vol', 'pp', 'al', 'inc', 'ltd',
  'co', 'corp', 'dept', 'approx', 'est', 'misc', 'jan', 'feb', 'mar', 'apr',
  'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
])

const findMechanicalFixes = (text, { triggers, ignore } = {}) => {
  const ranges = skipRanges(text, triggers)
  const ignored = new Set((ignore || []).map((word) => String(word).toLowerCase().replace(/’/g, "'")))
  const edits = []

  for (const token of tokenize(text)) {
    if (overlaps(ranges, token.start, token.start + token.text.length)) continue
    // Reject code-like tokens before removing surrounding prose punctuation.
    if (/[^A-Za-z'’",.;:!?()“”‘]/.test(token.text)) continue
    const normalized = token.text.replace(/’/g, "'")
    const body = normalized.replace(EDGE_PUNCTUATION, '')
    if (!/^[A-Za-z]+(?:'[A-Za-z]+)*(?:[,.;:!?]+[A-Za-z]+(?:'[A-Za-z]+)*)*$/.test(body)) continue
    const words = [...body.matchAll(/[A-Za-z]+(?:'[A-Za-z]+)*/g)]
    if (ignored.has(body.toLowerCase()) || words.some(([word]) => ignored.has(word.toLowerCase()) || !isCheckable(word, word))) continue

    const gaps = words.slice(1).map((word, index) => {
      const previous = words[index]
      const start = previous.index + previous[0].length
      return { start, end: word.index, punctuation: body.slice(start, word.index), previous: previous[0], next: word[0] }
    })
    // A period may be part of a domain, filename or abbreviation. Require a
    // familiar, capitalized sentence opening; leave all other dotted tokens.
    // Colons remain untouched because they commonly join identifier parts.
    if (gaps.some(({ punctuation, previous, next }) => {
      if (/^(?:,|;|[!?]+)$/.test(punctuation)) return false
      if (punctuation !== '.') return true
      return previous.length < 3 || ABBREVIATIONS.has(previous.toLowerCase()) || !SENTENCE_STARTS.has(next)
    })) continue

    const offset = token.start + normalized.indexOf(body)
    for (const word of words) {
      const replacement = CONTRACTIONS.get(word[0].toLowerCase())
      if (!replacement) continue
      const start = offset + word.index
      const end = start + word[0].length
      edits.push({ start, end, from: text.slice(start, end), to: matchCase(word[0], replacement) })
    }
    for (const gap of gaps) {
      const start = offset + gap.start
      const end = offset + gap.end
      edits.push({ start, end, from: text.slice(start, end), to: `${gap.punctuation} ` })
    }
  }

  return edits.sort((a, b) => a.start - b.start)
}

module.exports = { findCandidates, findMechanicalFixes, matchCase }
