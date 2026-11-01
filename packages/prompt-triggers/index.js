import { devIds } from './triggers/devIds.js'
import { devIdPaths } from './triggers/devIdPaths.js'

// Pure and synchronous: the UI runs this on every keystroke and the server
// runs it before each turn. Patterns need the `g` flag.
export const TRIGGERS = [devIds, devIdPaths]

// Matches from every applicable trigger, sorted by position. When matches
// overlap, the earlier (then longer) one wins.
export const findTriggers = (text, { steer = false } = {}) => {
  if (typeof text !== 'string' || !text) return []
  const matches = []
  for (const trigger of TRIGGERS) {
    if (steer && trigger.steer === false) continue
    for (const pattern of trigger.patterns) {
      for (const match of text.matchAll(pattern)) {
        if (!match[0]) continue
        matches.push({ id: trigger.id, start: match.index, end: match.index + match[0].length, text: match[0] })
      }
    }
  }
  matches.sort((a, b) => a.start - b.start || b.end - a.end)
  const out = []
  for (const match of matches) {
    if (out.length && match.start < out[out.length - 1].end) continue
    out.push(match)
  }
  return out
}

export const hasTrigger = (text, id, options) => findTriggers(text, options).some((match) => match.id === id)
