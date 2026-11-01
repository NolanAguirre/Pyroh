const { findTriggers } = require('../../../packages/prompt-triggers/index.js')
const { findCandidates, matchCase } = require('./words')
const { runJob } = require('./queue')

const MAX_SUGGESTIONS = 5

let spellPromise = null

// dictionary-en is ESM-only, so it loads through a dynamic import once.
const loadSpell = () => {
  spellPromise ??= (async () => {
    const nspell = require('nspell')
    const { default: dictionary } = await import('dictionary-en')
    return nspell(dictionary)
  })()
  return spellPromise
}

const triggerCounts = (text, steer) => {
  const counts = new Map()
  for (const match of findTriggers(text, { steer })) counts.set(match.id, (counts.get(match.id) || 0) + 1)
  return counts
}

const addsTrigger = (before, after) => {
  for (const [id, count] of after) if (count > (before.get(id) || 0)) return true
  return false
}

// Right to left keeps earlier offsets valid. Each fix is checked against the
// text as it stands, and dropped if it would make a trigger start firing.
const applyFixes = (text, fixes, steer) => {
  let out = text
  let counts = triggerCounts(out, steer)
  const applied = []
  for (const fix of [...fixes].sort((a, b) => b.start - a.start)) {
    const next = out.slice(0, fix.start) + fix.to + out.slice(fix.end)
    const nextCounts = triggerCounts(next, steer)
    if (addsTrigger(counts, nextCounts)) continue
    out = next
    counts = nextCounts
    applied.unshift(fix)
  }
  return { text: out, fixes: applied }
}

const checkText = async (text, { triggers, ignore, steer = false, timeoutMs }) => {
  const spell = await loadSpell()
  const unknown = findCandidates(text, { triggers, ignore })
    .filter((c) => !spell.correct(c.check))
    .map((c) => ({ ...c, suggestions: spell.suggest(c.check).slice(0, MAX_SUGGESTIONS) }))
    .filter((c) => c.suggestions.length)
  if (!unknown.length) return { text, fixes: [] }

  const result = await runJob(unknown.map(({ word, before, after, suggestions }) =>
    ({ word, before, after, suggestions })), timeoutMs)
  const picks = Array.isArray(result?.picks) ? result.picks : []

  const fixes = []
  unknown.forEach((c, i) => {
    const pick = picks[i]
    if (!Number.isInteger(pick) || pick < 1 || pick > c.suggestions.length) return
    const to = matchCase(c.word, c.suggestions[pick - 1])
    if (to !== c.word) fixes.push({ start: c.start, end: c.end, from: c.word, to })
  })
  return applyFixes(text, fixes, steer)
}

module.exports = { checkText, loadSpell }
