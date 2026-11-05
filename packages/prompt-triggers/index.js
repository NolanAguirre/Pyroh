import { devIds } from './triggers/devIds.js'
import { devIdPaths } from './triggers/devIdPaths.js'

// Commands occupy the entire input; mentions inside prose or multiline prompts
// remain ordinary agent input. Keep a bare command recognizable for validation.
export const parseInputCommand = (text) => {
  if (typeof text !== 'string' || /[\r\n\u2028\u2029]/.test(text)) return null
  const match = /^create\s+checkpoint(?:\s+(.*))?$/i.exec(text.trim())
  return match ? { type: 'create-checkpoint', name: (match[1] || '').trim() } : null
}

// Pure and synchronous: the UI runs this on every keystroke and the server
// runs it before each turn. Patterns need the `g` flag.
//
// scope: 'message' applies to every user message (prompts, follow-ups,
// queued messages, steers, answers); 'first' only to the first prompt sent
// to a new agent or subagent.
export const TRIGGERS = [devIds, devIdPaths]

export const inScope = (trigger, { first = true } = {}) => first || trigger.scope !== 'first'

// Matches from every applicable trigger, sorted by position. When matches
// overlap, the earlier (then longer) one wins. `first: false` skips
// first-prompt-only triggers.
export const findTriggers = (text, options = {}) => {
  if (typeof text !== 'string' || !text) return []
  const matches = []
  for (const trigger of TRIGGERS) {
    if (!inScope(trigger, options)) continue
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
